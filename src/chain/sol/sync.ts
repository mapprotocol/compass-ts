import { PublicKey } from "@solana/web3.js";
import { web3 } from "@project-serum/anchor";
import { VersionedTransactionResponse } from "@solana/web3.js";
import { delay } from '../../utils/time'
import { Chain } from '../../config/config'
import { getSyncCursor, saveSyncCursor, saveSyncDeadLetter } from '../../storages/mysql/mysql'
import { SolEventHandler } from './handler'
import { SolEventParser } from './parser'

const SIGNATURE_PAGE_LIMIT = 1000;
const SOLANA_COMMITMENT = "finalized";

export class SolChain {
  cfg: Chain;
  butter: string;
  butterApiKey: string;
  parser: SolEventParser;
  handler: SolEventHandler;
  mcsAddresses: string[];

  constructor(cfg: Chain, butter: string, butterApiKey: string) {
    this.cfg = cfg
    this.butter = butter
    this.butterApiKey = butterApiKey
    this.mcsAddresses = Array.from(new Set(
      (Array.isArray(cfg.opts.mcs) ? cfg.opts.mcs : [cfg.opts.mcs]).filter((address) => !!address),
    ))
    this.parser = new SolEventParser({ eventProgramIds: this.mcsAddresses })
    this.handler = new SolEventHandler(cfg, butter, butterApiKey)
  }

  getName(): string {
    return this.cfg.name
  }

  async sync() {
    console.log("web3.clusterApiUrl(cluster) ----------------- ", this.cfg.endpoint)
    let connection = new web3.Connection(this.cfg.endpoint, SOLANA_COMMITMENT);
    let cursors = await this.loadCursors()
    for (; ;) {
      try {
        cursors = await this.syncOnce(connection, cursors)
      } catch (err) {
        console.log("solana catch err", err)
        await delay(3000)
      } finally {
        console.log("solana filter is running")
        await delay(3000)
      }
    }
  }

  async syncOnce(connection: web3.Connection, cursors: Map<string, string>): Promise<Map<string, string>> {
    const nextCursors = new Map(cursors)
    const handledTxHashes = new Set<string>()

    for (const mcsAddress of this.mcsAddresses) {
      const begin = nextCursors.get(mcsAddress) || this.getStartBlock(mcsAddress)
      try {
        const nextBegin = await this.syncAddressOnce(connection, mcsAddress, begin, handledTxHashes)
        nextCursors.set(mcsAddress, nextBegin)
        await this.saveCursor(mcsAddress, nextBegin)
      } catch (err) {
        console.log("solana sync address failed", mcsAddress, "begin", begin, "err", err)
      }
    }

    return nextCursors
  }

  private async syncAddressOnce(
    connection: web3.Connection,
    mcsAddress: string,
    begin: string,
    handledTxHashes: Set<string>,
  ): Promise<string> {
    console.log("mcs ------------------ ", mcsAddress, "begin ------------------ ", begin)
    const contract = new PublicKey(mcsAddress)
    const signs = await this.getSignaturesSince(connection, contract, begin)

    if (signs == null || signs.length == 0) {
      await delay(3000)
      return begin
    }

    let nextBegin = begin
    for (let index = signs.length - 1; index >= 0; index--) {
      let txHash = signs[index].signature
      console.log("mcsAddress ------- ", mcsAddress, " txHash --------- ", txHash)
      if (handledTxHashes.has(txHash)) {
        console.log("Skip duplicate solana txHash", txHash)
        nextBegin = signs[index].signature;
        continue
      }

      let trx: VersionedTransactionResponse | null
      try {
        trx = await connection.getTransaction(txHash, {
          commitment: SOLANA_COMMITMENT,
          maxSupportedTransactionVersion: 1,
        })
      } catch (err) {
        console.log("solana getTransaction failed, retry next round", txHash, "err", err)
        return nextBegin
      }

      if (trx == null) {
        console.log("solana getTransaction returned null, retry next round", txHash)
        return nextBegin
      }

      try {
        await this.handleTransaction(connection, txHash, mcsAddress, trx)
      } catch (err) {
        console.log("solana handle tx failed, dead-letter and continue", txHash, "err", err)
        await this.saveDeadLetter(mcsAddress, txHash, "handleTransaction", toError(err))
      }
      handledTxHashes.add(txHash)
      nextBegin = signs[index].signature;
    }

    return nextBegin
  }

  private async getSignaturesSince(
    connection: web3.Connection,
    contract: PublicKey,
    begin: string,
  ): Promise<Array<{ signature: string }>> {
    const signatures: Array<{ signature: string }> = []
    let before = ""

    for (; ;) {
      const options: { limit: number; until?: string; before?: string } = {
        limit: SIGNATURE_PAGE_LIMIT,
      }
      if (begin) {
        options.until = begin
      }
      if (before) {
        options.before = before
      }

      const page = await connection.getSignaturesForAddress(contract, options, SOLANA_COMMITMENT)
      if (page == null || page.length == 0) {
        break
      }

      signatures.push(...page)
      if (page.length < SIGNATURE_PAGE_LIMIT) {
        break
      }

      const nextBefore = page[page.length - 1].signature
      if (nextBefore === before) {
        break
      }
      before = nextBefore
    }

    return signatures
  }

  async handleTransaction(connection: web3.Connection, txHash: string, mcsAddress: string, trx: VersionedTransactionResponse | null): Promise<void> {
    if (trx?.meta?.err) {
      console.log("Skip failed solana tx", txHash, "err", JSON.stringify(trx.meta.err))
      return
    }

    const events = this.parser.parseTransaction(trx)

    for (let parsedEvent of events.chainPoolEvents) {
      const event = parsedEvent.event
      if (event.name === "CrossOutEvent") {
        await this.handler.crossOut(event, txHash, parsedEvent.programId, connection, trx)
      }
    }

    for (let parsedEvent of events.receiverEvents) {
      const event = parsedEvent.event
      if (event.name === "CrossInEvent" || event.name === "RefundEvent") {
        await this.handler.crossIn(event, txHash, parsedEvent.programId, trx)
      }
    }
  }

  private getStartBlock(mcsAddress: string): string {
    const startBlock = this.cfg.opts.startBlock
    if (typeof startBlock === "string") {
      return startBlock
    }
    return startBlock[mcsAddress] || ""
  }

  private async loadCursors(): Promise<Map<string, string>> {
    const cursors = new Map<string, string>()

    for (const address of this.mcsAddresses) {
      try {
        const cursor = await getSyncCursor(this.cfg.id, address)
        cursors.set(address, cursor || this.getStartBlock(address))
      } catch (err) {
        console.log("solana load cursor failed, fallback to startBlock", address, "err", err)
        cursors.set(address, this.getStartBlock(address))
      }
    }

    return cursors
  }

  private async saveCursor(mcsAddress: string, cursor: string): Promise<void> {
    try {
      await saveSyncCursor(this.cfg.id, mcsAddress, cursor)
    } catch (err) {
      console.log("solana save cursor failed", mcsAddress, "cursor", cursor, "err", err)
    }
  }

  private async saveDeadLetter(mcsAddress: string, txHash: string, stage: string, error: Error): Promise<void> {
    try {
      await saveSyncDeadLetter(this.cfg.id, mcsAddress, txHash, stage, error, isRetryableError(error))
    } catch (err) {
      console.log("solana save dead-letter failed", mcsAddress, "txHash", txHash, "err", err)
    }
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

function isRetryableError(error: Error): boolean {
  return /(^|[^0-9])(429|500|502|503|504)([^0-9]|$)|timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT/i
    .test(`${error.name} ${error.message}`)
}
