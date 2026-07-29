import { PublicKey } from "@solana/web3.js";
import { web3 } from "@project-serum/anchor";
import { VersionedTransactionResponse } from "@solana/web3.js";
import { delay } from '../../utils/time'
import { Chain } from '../../config/config'
import { SolEventHandler } from './handler'
import { SolEventParser } from './parser'

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
    let connection = new web3.Connection(this.cfg.endpoint);
    let cursors = new Map(this.mcsAddresses.map((address) => [address, this.getStartBlock(address)]))
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
      const nextBegin = await this.syncAddressOnce(connection, mcsAddress, begin, handledTxHashes)
      nextCursors.set(mcsAddress, nextBegin)
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
    let constract = new PublicKey(mcsAddress)
    let signs = await connection.getSignaturesForAddress(constract, begin ? {
      until: begin,
      limit: 10,
    } : {
      limit: 10,
    })

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

      const trx = await connection.getTransaction(txHash, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 1,
      })

      await this.handleTransaction(connection, txHash, mcsAddress, trx)
      handledTxHashes.add(txHash)
      nextBegin = signs[index].signature;
    }

    return nextBegin
  }

  async handleTransaction(connection: web3.Connection, txHash: string, mcsAddress: string, trx: VersionedTransactionResponse | null): Promise<void> {
    if (trx?.meta?.err) {
      console.log("Skip failed solana tx", txHash, "err", JSON.stringify(trx.meta.err))
      return
    }

    const events = this.parser.parseTransaction(trx)

    for (let event of events.chainPoolEvents) {
      if (event.name === "CrossOutEvent") {
        await this.handler.crossOut(event, txHash, mcsAddress, connection, trx)
      }
    }

    for (let event of events.receiverEvents) {
      if (event.name === "CrossInEvent" || event.name === "RefundEvent") {
        await this.handler.crossIn(event, txHash, mcsAddress, trx)
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
}
