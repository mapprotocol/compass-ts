import { Event } from "@project-serum/anchor";
import { PublicKey, Connection, VersionedTransactionResponse } from "@solana/web3.js";
import { ethers } from "ethers";
import { Chain } from '../../config/config'
import { Log } from '../../storages/model'
import { insertMos } from '../../storages/mysql/mysql'
import { alarm } from '../../utils/alarm/slack'
import {
  requestBridgeData
} from "../../utils/butter/butter";
import {
  convertHexToBtcAddress,
  isFirst12Zero,
  mergeArraysWithColon,
  parseMintAccount,
} from "./utils";

const DEFAULT_SUPPORTED_CROSS_OUT_BRIDGE_MINTS = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "So11111111111111111111111111111111111111112",
];
const DEFAULT_NATIVE_TOKEN_OUT_ADDRESS = "0x0000000000000000000000000000000000000000";

export class SolEventHandler {
  constructor(
    private readonly cfg: Chain,
    private readonly butter: string,
    private readonly butterApiKey: string,
  ) { }

  async crossOut(event: Event, txHash: string, contractAddress: string, conn: Connection, trx: VersionedTransactionResponse | null) {
    if (event.name !== "CrossOutEvent") {
      console.log("ignore crossOut tx ",txHash, " event.name ------------ ", event.name)
      return
    }
    console.log("Find CrossOut emit_cpi tx", txHash, "slot", trx?.slot, "blockTime", trx?.blockTime)
    const orderId = Buffer.from(Uint8Array.from(event.data.order_id)).toString("hex");
    const bridgeMint = event.data.bridge_mint as PublicKey
    if (!this.getSupportedBridgeMints().has(bridgeMint.toBase58())) {
      const message = `Solana unsupported CrossOut bridgeMint ${bridgeMint.toBase58()} txHash ${txHash}`
      console.log(message)
      await alarm(message)
      throw new Error(message)
    }
    console.log("event.name ------------------- ", event.name)
    console.log("orderId ------------------ ", orderId)
    console.log(
      `CrossOutEvent: orderId[${orderId}],
          user[${event.data.user}],
          fromChain[${event.data.from_chain}],
          toChain[${event.data.to_chain}],
          bridgeMint[${event.data.bridge_mint}],
          bridgeAmount[${event.data.bridge_amount}],
          toToken[${event.data.to_token}],
          receiver[${event.data.receiver}],
          minAmountOut[${event.data.min_amount_out}],
          fromToken[${event.data.source_token}],
          sourceAmount[${event.data.source_amount}],
          refererId[${event.data.referer_id}],
          feeRatio[${event.data.fee_ratio}],`
    );

    let data = new Map()
    data.set("orderId", orderId)
    data.set("user", normalizeEventValue(event.data.user))
    data.set("from", publicKeyToBytes(event.data.user))
    data.set("fromChain", normalizeEventNumberHex(event.data.from_chain))
    data.set("fromChainId", normalizeEventNumberHex(event.data.from_chain))
    data.set("toChain", normalizeEventNumberHex(event.data.to_chain))
    data.set("bridgeMint", normalizeEventValue(event.data.bridge_mint))
    data.set("bridgeAmount", normalizeEventValue(event.data.bridge_amount))
    data.set("tokenAmount", normalizeEventNumberHex(event.data.bridge_amount))
    data.set("toToken", normalizeEventValue(event.data.to_token))
    data.set("receiver", normalizeEventValue(event.data.receiver))
    data.set("minAmountOut", normalizeEventNumberHex(event.data.min_amount_out))
    data.set("swapTokenOutMinAmountOut", normalizeEventNumberHex(event.data.min_amount_out))
    data.set("fromToken", normalizeEventValue(event.data.source_token))
    data.set("sourceAmount", normalizeEventNumberHex(event.data.source_amount))
    data.set("amountOut", normalizeEventNumberHex(event.data.bridge_amount))
    data.set("refererId", normalizeEventValue(event.data.referer_id))
    data.set("feeRatio", normalizeEventValue(event.data.fee_ratio))
    data.set("originReceiver", normalizeEventValue(event.data.receiver))

    const user = event.data.user as PublicKey

    const toTokenBytes = new Uint8Array(32);
    toTokenBytes.set(event.data.to_token, 0)
    let toToken = this.resolveTokenOutAddress(toTokenBytes);
    if (toToken == "0x0000000000000000000000000000000000425443") {
      toToken = "0x425443"
    }

    const receiverBytes = new Uint8Array(33);
    receiverBytes.set(event.data.receiver, 0)
    let receiver = ethers.getAddress(ethers.hexlify(receiverBytes.slice(13)))
    if (event.data.to_chain.toString() == "1360095883558913") {
      let btcBytes = receiverBytes;
      if (isFirst12Zero(receiverBytes) == true) {
        btcBytes = receiverBytes.slice(12)
      }
      let btcAddr = ethers.hexlify(btcBytes)
      console.log("btcAddr ----------------- ", btcAddr)
      receiver = convertHexToBtcAddress(btcAddr)
      console.log("btcAddr ----------------- ", receiver)
    }
    data.set("receiver", receiver)

    const bridgeTokenInfo = await conn.getAccountInfo(bridgeMint);
    if (!bridgeTokenInfo?.data) {
      throw new Error("Bridge Token mint account not found");
    }
    const dec = parseMintAccount(bridgeTokenInfo.data);
    console.log("mintAccountInfo ", dec.decimals, " bridgeToken ", bridgeMint.toBase58())
    const result = ethers.formatUnits(BigInt(event.data.bridge_amount.toString()), dec.decimals);
    let entranceId = "9";
    if (event.data.referer_id.length > 0) {
      entranceId = event.data.referer_id[0].toString()
    }
    let affiliate = mergeArraysWithColon(event.data.referer_id, event.data.fee_ratio)

    let ret = await requestBridgeData(this.butter, txHash, this.butterApiKey, {
      entrance: this.cfg.opts.butterEntrance,
      affiliate: affiliate,
      fromChainID: event.data.from_chain.toString(),
      toChainID: event.data.to_chain.toString(),
      amount: result,
      tokenInAddress: bridgeMint.toBase58(),
      tokenOutAddress: toToken,
      minAmountOut: event.data.min_amount_out.toString(),
      receiver: receiver,
      caller: user.toBase58(),
      entranceId: entranceId,
    })
    data.set("relay", ret.relay)
    data.set("swapData", ret.data)
    data.set("receiver", ret.receiver)
    console.log("crossOut request bridgeApi back data", ret)
    let dataStr = JSON.stringify(Object.fromEntries(data))
    var l: Log = {
      ChainId: this.cfg.id,
      EventId: 98,
      ProjectId: 7,
      TxHash: txHash,
      ContractAddres: contractAddress,
      Topic: "crossOut",
      BlockNumber: trx?.slot || 0,
      BlockHash: "",
      TxIndex: 1,
      LogIndex: 1,
      LogData: dataStr,
      TxTimestamp: trx?.blockTime || 0,
    }

    await insertMos(l, (err: Error | null, id?: number) => {
      if (err) {
        console.log("CrossOut Insert Failed, txHash:", txHash, "err:", err);
        return
      }
      console.log("CrossOut Insert Success, txHash:", txHash, "id:", id);
    })
  }

  private getSupportedBridgeMints(): Set<string> {
    const configuredMints = this.cfg.opts.supportedBridgeMints || []
    return new Set(configuredMints.length > 0 ? configuredMints : DEFAULT_SUPPORTED_CROSS_OUT_BRIDGE_MINTS)
  }

  private resolveTokenOutAddress(toTokenBytes: Uint8Array): string {
    if (isZeroBytes(toTokenBytes)) {
      const nativeTokenOutAddress = this.cfg.opts.nativeTokenOutAddress || DEFAULT_NATIVE_TOKEN_OUT_ADDRESS
      return ethers.getAddress(nativeTokenOutAddress)
    }

    return ethers.getAddress(ethers.hexlify(toTokenBytes.slice(12)));
  }

  async crossIn(event: Event, txHash: string, contractAddress: string, trx: VersionedTransactionResponse | null) {
    if (event.name !== "CrossInEvent" && event.name !== "RefundEvent") {
      console.log("ignore crossIn tx ",txHash, " event.name ------------ ", event.name)
      return
    }
    console.log("Find CrossIn emit_cpi tx", txHash, "slot", trx?.slot, "blockTime", trx?.blockTime)
    const orderId = Buffer.from(Uint8Array.from(event.data.order_id)).toString("hex");
    console.log("event.name ------------------- ", event.name)
    console.log("orderId ------------------ ", orderId)
    const crossInLogFields = [
      `orderId[${orderId}]`,
      `user[${event.data.user}]`,
      event.data.from_chain !== undefined ? `fromChain[${event.data.from_chain}]` : null,
      `bridgeMint[${event.data.bridge_mint}]`,
      event.data.bridge_amount !== undefined ? `bridgeAmount[${event.data.bridge_amount}]` : null,
      event.data.dest_token !== undefined ? `destToken[${event.data.dest_token}]` : null,
      event.data.amount !== undefined ? `amount[${event.data.amount}]` : null,
      event.data.amount_out !== undefined ? `amountOut[${event.data.amount_out}]` : null,
      event.data.signed_min_amount_out !== undefined
        ? `signedMinAmountOut[${event.data.signed_min_amount_out}]`
        : null,
      event.data.effective_min_amount_out !== undefined
        ? `effectiveMinAmountOut[${event.data.effective_min_amount_out}]`
        : null,
    ].filter((field): field is string => field !== null)
    console.log(`${event.name}: ${crossInLogFields.join(",\n          ")}`);

    let data = new Map()
    data.set("orderId", orderId)
    data.set("user", normalizeEventValue(event.data.user))
    data.set("from", publicKeyToBytes(event.data.user))
    data.set("fromToken", zeroBytes(32))
    if (event.data.from_chain !== undefined) {
      data.set("fromChainId", normalizeEventNumberHex(event.data.from_chain))
    } else {
      data.set("fromChainId", "00")
    }
    data.set("bridgeMint", normalizeEventValue(event.data.bridge_mint))
    if (event.data.bridge_amount !== undefined) {
      data.set("bridgeAmount", normalizeEventNumberHex(event.data.bridge_amount))
      data.set("tokenAmount", normalizeEventNumberHex(event.data.bridge_amount))
    } else {
      data.set("tokenAmount", "00")
    }
    if (event.data.dest_token !== undefined) {
      data.set("destToken", normalizeEventValue(event.data.dest_token))
      data.set("toToken", publicKeyToBytes(event.data.dest_token))
    } else {
      data.set("toToken", publicKeyToBytes(event.data.bridge_mint))
    }
    if (event.data.amount !== undefined) {
      data.set("amount", normalizeEventNumberHex(event.data.amount))
    }
    if (event.data.amount_out !== undefined) {
      data.set("amountOut", normalizeEventNumberHex(event.data.amount_out))
    }
    if (event.data.signed_min_amount_out !== undefined) {
      data.set("signedMinAmountOut", normalizeEventNumberHex(event.data.signed_min_amount_out))
      data.set("minAmountOut", normalizeEventNumberHex(event.data.signed_min_amount_out))
      data.set("swapTokenOutMinAmountOut", normalizeEventNumberHex(event.data.signed_min_amount_out))
    } else {
      data.set("minAmountOut", "00")
      data.set("swapTokenOutMinAmountOut", "00")
    }
    if (event.data.effective_min_amount_out !== undefined) {
      data.set("effectiveMinAmountOut", normalizeEventNumberHex(event.data.effective_min_amount_out))
    }
    data.set("refererId", null)
    data.set("feeRatio", null)
    data.set("receiver", normalizeEventValue(event.data.user))
    if (event.name === "RefundEvent") {
      data.set("isrefund", true)
    }

    let dataStr = JSON.stringify(Object.fromEntries(data))
    var l: Log = {
      ChainId: this.cfg.id,
      EventId: 124,
      ProjectId: 7,
      TxHash: txHash,
      ContractAddres: contractAddress,
      Topic: "crossIn",
      BlockNumber: trx?.slot || 0,
      BlockHash: "",
      TxIndex: 1,
      LogIndex: 1,
      LogData: dataStr,
      TxTimestamp: trx?.blockTime || 0,
    }

    await insertMos(l, (err: Error | null, id?: number) => {
      if (err) {
        console.log("CrossIn Insert Failed, txHash:", txHash, "err:", err);
        return
      }
      console.log("CrossIn Insert Success, txHash:", txHash, "id:", id);
    })
  }
}

function normalizeEventValue(value: any): any {
  if (value?.toBase58) {
    return value.toBase58();
  }
  if (value?.toString && value.constructor?.name === "BN") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeEventValue);
  }
  return value;
}

function normalizeEventNumberHex(value: any): string {
  if (value === null || value === undefined) {
    return "00";
  }
  const hex = BigInt(value.toString()).toString(16);
  return hex.length % 2 === 0 ? hex : `0${hex}`;
}

function publicKeyToBytes(value: PublicKey | undefined): number[] {
  if (!value?.toBytes) {
    return zeroBytes(32);
  }
  return Array.from(value.toBytes());
}

function isZeroBytes(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

function zeroBytes(length: number): number[] {
  return Array.from({ length }, () => 0);
}
