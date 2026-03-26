import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
const { Buffer } = require("buffer");
const crypto = require("crypto");
import {BorshCoder, EventParser, Event, Program, web3} from "@project-serum/anchor";
import {VersionedTransactionResponse} from "@solana/web3.js";
import { publicKey, } from "@project-serum/anchor/dist/cjs/utils";
import { delay } from '../../utils/time'
import { Chain } from '../../config/config'
import { Log } from '../../storages/model'
import { insertMos } from '../../storages/mysql/mysql'
import { sign } from "crypto";
import { error, time } from "console";
import { start } from "repl";
import {
  requestBridgeData
} from "../../utils/butter/butter";
import * as bitcoin from 'bitcoinjs-lib';
import * as address from 'bitcoinjs-lib/src/address';

export class SolChain {
    cfg:Chain;
    butter:string;
    constructor(cfg:Chain, butter:string) {
      this.cfg = cfg
      this.butter = butter
    }

    getName():string {
      return this.cfg.name
    }

    async sync() {
      console.log("web3.clusterApiUrl(cluster) ----------------- ", this.cfg.endpoint)
      let connection = new web3.Connection(this.cfg.endpoint);
      let constract  = new PublicKey(this.cfg.opts.mcs)
      let begin :string = this.cfg.opts.startBlock
      // sol2evm
      const idl = require("../../../src/chain/sol/chainpool.json");
      const programId = new PublicKey(idl.metadata.address);
      // messageout
      const messoutIdl = require("../../../src/chain/sol/messout.json");
      const outProgramId = new PublicKey(messoutIdl.metadata.address);
      for (;;) {
        try {
          console.log("begin ------------------ ", begin)
          let signs = await connection.getSignaturesForAddress(constract, {
            until: begin,
            limit:10,
          })

          if (signs == null || signs.length == 0) {
            await delay(3000)
            continue
          }
          for (let index = signs.length-1; index >= 0; index--) {
            let txHash = signs[index].signature
            console.log("txHash --------------------------- ", txHash)
            const trx = await connection.getTransaction(txHash, {
                commitment: "confirmed",
                maxSupportedTransactionVersion:1,
            })
            // sol2evm
            // corssOut event
            const eventParser = new EventParser(programId, new BorshCoder(idl));
            let logs:string[] = trx?.meta?.logMessages!;
            const events = eventParser.parseLogs(logs);
            let haveBegin:boolean = false;
            let haveFinish:boolean = false;
            for (let event of events) {
              if (event.name == "CrossBeginEvent") {
                haveBegin = true;
              }
              if (event.name == "CrossFinishEvent") {
                  haveFinish = true;
              }
              await this.crossOut(event, haveBegin, haveFinish,txHash, connection, trx)
              await this.crossIn(event, haveBegin, haveFinish,txHash, connection, trx)
            }
             // messageOut
            let outLogs:string[] = trx?.meta?.logMessages!;
            const messageOutEp = new EventParser(outProgramId, new BorshCoder(messoutIdl));
            const outEvents = messageOutEp.parseLogs(outLogs);
            for (let event of outEvents) {
             this.messageOut(event, txHash, trx)
            }

            begin = signs[index].signature;
          }
        } catch (err){
          console.log("solana catch err", err)
          await delay(3000)
        } finally {
          console.log("solana filter is running")
          await delay(3000)
        }
      }
    }

    async crossOut(event:Event, haveBegin:boolean, haveFinish:boolean, txHash:string, conn:web3.Connection, trx:VersionedTransactionResponse|null) {
      if (!haveBegin || !haveFinish) {
        return
      }

      let isOut: boolean = ("crossOut" in event.data.crossType)
      if (!isOut) {
        console.log("Ignore tx", txHash, ",tx not crossout event", event.data.crossType)
        return
      }
      console.log("Find CrossOut tx", txHash, "slot", trx?.slot, "blockTime",trx?.blockTime)
      const orderId = Buffer.from(Uint8Array.from(event.data.orderRecord.orderId)).toString("hex");
      console.log("event.name ------------------- ", event.name)
      console.log("orderId ------------------ ", orderId)
      console.log(
          `CrossFinishEvent: orderId[${orderId}],
          amount_out[${event.data.amountOut}],
          tokenAmount[${event.data.orderRecord.tokenAmount}],
          from[${event.data.orderRecord.from}],
          fromToken[${event.data.orderRecord.fromToken}],
          toToken[${event.data.orderRecord.toToken}],
          swapTokenOut[${event.data.orderRecord.swapTokenOut}],
          swapTokenOutMinAmountOut[${event.data.orderRecord.swapTokenOutMinAmountOut}],
          minAmountOut[${event.data.orderRecord.minAmountOut}],
          swapTokenOutBeforeBalance[${event.data.orderRecord.swapTokenOutBeforeBalance}],
          afterBalance[${event.data.afterBalance}],
          receiver[${event.data.orderRecord.receiver}],
          toChain[${event.data.orderRecord.toChainId}],
          fromChainId[${event.data.orderRecord.fromChainId}],
          refererId[${event.data.orderRecord.refererId}],
          feeRatio[${event.data.orderRecord.feeRatio}],`
      );
      let data = new Map()
      data.set("orderId", orderId)
      data.set("tokenAmount", event.data.orderRecord.tokenAmount)
      data.set("from", event.data.orderRecord.from)
      data.set("fromToken", event.data.orderRecord.fromToken)
      data.set("toToken", event.data.orderRecord.toToken)
      data.set("swapTokenOut", event.data.orderRecord.swapTokenOut)
      data.set("swapTokenOutMinAmountOut", event.data.orderRecord.swapTokenOutMinAmountOut)
      data.set("minAmountOut", event.data.orderRecord.minAmountOut)
      data.set("swapTokenOutBeforeBalance", event.data.orderRecord.swapTokenOutBeforeBalance)
      data.set("afterBalance", event.data.afterBalance)
      data.set("toChain", event.data.orderRecord.toChainId)
      data.set("fromChainId", event.data.orderRecord.fromChainId)
      data.set("amountOut", event.data.amountOut)
      data.set("refererId", event.data.orderRecord.refererId)
      data.set("feeRatio", event.data.orderRecord.feeRatio)
      data.set("originReceiver", event.data.orderRecord.receiver)
      // request swapData
      let swapTokenOut = new PublicKey(event.data.orderRecord.swapTokenOut)
      let from = new PublicKey(event.data.orderRecord.from)

      const toTokenBytes = new Uint8Array(32);
      toTokenBytes.set(event.data.orderRecord.toToken, 0)
      let toToken = ethers.getAddress(ethers.hexlify(toTokenBytes.slice(0, 20)));
      if (toToken == "0x0000000000000000000000000000000000425443") {
        toToken = "0x425443"
      }

      const receiverBytes = new Uint8Array(33);
      receiverBytes.set(event.data.orderRecord.receiver, 0)
      // evm
      let receiver = ethers.getAddress(ethers.hexlify(receiverBytes.slice(13)))
      // btc
      if (event.data.orderRecord.toChainId == 1360095883558913) {
        let btcBytes = receiverBytes;
        if (this.isFirst12Zero(receiverBytes) == true) {
          btcBytes = receiverBytes.slice(12)
        }
        let btcAddr = ethers.hexlify(btcBytes)
        console.log("btcAddr ----------------- ",btcAddr)
        receiver = this.convertHexToBtcAddress(btcAddr)
        console.log("btcAddr ----------------- ",receiver)
      }
      data.set("receiver", receiver)

      // get ata mint token
      const mintAccountInfo = await conn.getAccountInfo(swapTokenOut);
      if (!mintAccountInfo?.data) {
        throw new Error("Token mint account not found");
      }
      const mintPubkey = new PublicKey(mintAccountInfo.data.slice(0, 32)); 
      console.log("bridgeToken is ----------------- ", mintPubkey.toBase58())
    
      // get token decimal
      const bridgeTokenInfo = await conn.getAccountInfo(mintPubkey);
      if (!bridgeTokenInfo?.data) {
        throw new Error("Bridge Token mint account not found");
      }
      const dec = parseMintAccount(bridgeTokenInfo.data);
      console.log("mintAccountInfo ", dec.decimals , " swapTokenOut ", swapTokenOut, " bridgeToken ", mintPubkey.toBase58())
      const beforeAmount = BigInt(event.data.amountOut);
      const result = ethers.formatUnits(beforeAmount, dec.decimals);
      let entranceId = "9";
      if (event.data.orderRecord.refererId.length > 0) {
        entranceId = event.data.orderRecord.refererId[0]
      }
      let affiliate = mergeArraysWithColon(event.data.orderRecord.refererId, event.data.orderRecord.feeRatio)
      let ret = await requestBridgeData(this.butter, txHash, {
        entrance: this.cfg.opts.butterEntrance,
        affiliate: affiliate,
        fromChainID:  event.data.orderRecord.fromChainId,
        toChainID: event.data.orderRecord.toChainId,
        amount: result,
        tokenInAddress: mintPubkey.toBase58(),
        tokenOutAddress: toToken,
        minAmountOut: event.data.orderRecord.minAmountOut,
        receiver: receiver,
        caller: from.toBase58(),
        entranceId:entranceId,
      })
      data.set("relay", ret.relay)
      data.set("swapData", ret.data)
      data.set("receiver", ret.receiver)
      console.log("crossOut request bridgeApi back data", ret)
      let dataStr = JSON.stringify(Object.fromEntries(data))
      var l:Log = {
        ChainId: this.cfg.id,
        EventId: 98,
        ProjectId: 7,
        TxHash: txHash,
        ContractAddres: this.cfg.opts.mcs,
        Topic: "crossOut",
        BlockNumber: trx?.slot || 0,
        BlockHash:"",
        TxIndex: 1,
        LogIndex: 1,
        LogData: dataStr,
        TxTimestamp: trx?.blockTime || 0,
      }
      
      await insertMos(l, (err:Error, id: number) => {
        if (err) {
          console.log("CrossOut Insert Failed, txHash:", txHash, "err:", err);
          return
        }
        console.log("CrossOut Insert Success, txHash:", txHash, "id:", id);
      })
    }

    async crossIn(event:Event, haveBegin:boolean, haveFinish:boolean, txHash:string, conn:web3.Connection, trx:VersionedTransactionResponse|null) {
      if (!haveBegin || !haveFinish) {
        return
      }

      let isOut: boolean = ("crossIn" in event.data.crossType)
      if (!isOut) {
        console.log("Ignore tx", txHash, ",tx not crossIn event", event.data.crossType)
        return
      }
      console.log("Find CrossIn tx", txHash, "slot", trx?.slot, "blockTime",trx?.blockTime)
      const orderId = Buffer.from(Uint8Array.from(event.data.orderRecord.orderId)).toString("hex");
      console.log("event.name ------------------- ", event.name)
      console.log("orderId ------------------ ", orderId)
      console.log(
          `
          CrossInEvent: orderId[${orderId}],
          amount_out[${event.data.amountOut}],
          tokenAmount[${event.data.orderRecord.tokenAmount}],
          from[${event.data.orderRecord.from}],
          fromToken[${event.data.orderRecord.fromToken}],
          toToken[${event.data.orderRecord.toToken}],
          swapTokenOut[${event.data.orderRecord.swapTokenOut}],
          swapTokenOutMinAmountOut[${event.data.orderRecord.swapTokenOutMinAmountOut}],
          minAmountOut[${event.data.orderRecord.minAmountOut}],
          swapTokenOutBeforeBalance[${event.data.orderRecord.swapTokenOutBeforeBalance}],
          receiver[${event.data.orderRecord.receiver}],
          toChain[${event.data.orderRecord.toChainId}],
          fromChainId[${event.data.orderRecord.fromChainId}],
          refererId[${event.data.orderRecord.refererId}],
          feeRatio[${event.data.orderRecord.feeRatio}],
          `
      );

      let receiver = new PublicKey(event.data.orderRecord.receiver.slice(0,32))
      let data = new Map()
      data.set("orderId", orderId)
      data.set("tokenAmount", event.data.orderRecord.tokenAmount)
      data.set("amountOut", event.data.amountOut)
      data.set("from", event.data.orderRecord.from)
      data.set("fromToken", event.data.orderRecord.fromToken)
      data.set("toToken", event.data.orderRecord.toToken)
      data.set("swapTokenOut", event.data.orderRecord.swapTokenOut)
      data.set("swapTokenOutMinAmountOut", event.data.orderRecord.swapTokenOutMinAmountOut)
      data.set("minAmountOut", event.data.orderRecord.minAmountOut)
      data.set("swapTokenOutBeforeBalance", event.data.orderRecord.swapTokenOutBeforeBalance)
      data.set("toChain", event.data.orderRecord.toChainId)
      data.set("fromChainId", event.data.orderRecord.fromChainId)
      data.set("refererId", event.data.orderRecord.refererId)
      data.set("feeRatio", event.data.orderRecord.feeRatio)
      data.set("receiver", receiver.toBase58())
      
      let dataStr = JSON.stringify(Object.fromEntries(data))
      var l:Log = {
        ChainId: this.cfg.id,
        EventId: 124,
        ProjectId: 7,
        TxHash: txHash,
        ContractAddres: this.cfg.opts.mcs,
        Topic: "crossIn",
        BlockNumber: trx?.slot || 0,
        BlockHash:"",
        TxIndex: 1,
        LogIndex: 1,
        LogData: dataStr,
        TxTimestamp: trx?.blockTime || 0,
      }
      
      await insertMos(l, (err:Error, id: number) => {
        if (err) {
          console.log("CrossOut Insert Failed, txHash:", txHash, "err:", err);
          return
        }
        console.log("CrossOut Insert Success, txHash:", txHash, "id:", id);
      })
    }

    messageOut(event:Event, txHash:string, trx:VersionedTransactionResponse|null) {
       if (event.name != "MessageOutEvent") {
         console.log("------------------ event.name ", event.name)
         return
       }

      const orderId = Buffer.from(Uint8Array.from(event.data.orderId)).toString("hex");
      const mos = Buffer.from(Uint8Array.from(event.data.mos)).toString("hex");
      const to = Buffer.from(Uint8Array.from(event.data.to)).toString("hex");
      const swapData = Buffer.from(Uint8Array.from(event.data.swapData)).toString("hex");

      const token = Buffer.from(new PublicKey(event.data.token).toBytes()).toString("hex");
      const initiator = Buffer.from(new PublicKey(event.data.initiator).toBytes()).toString("hex");
      const from = Buffer.from(new PublicKey(event.data.from).toBytes()).toString("hex");

      console.log("Find MessageOut tx", txHash, "slot", trx?.slot, "blockTime",trx?.blockTime)
      console.log(`
        MessageOutEvent: orderId[${orderId}],
        MessageOutEvent: relay[${event.data.relay}],
        MessageOutEvent: messageType[${event.data.messageType}],
        MessageOutEvent: fromChain[${event.data.fromChain}],
        MessageOutEvent: toChain[${event.data.toChain}],
        MessageOutEvent: mos[${mos}],
        MessageOutEvent: token[${event.data.token}],
        MessageOutEvent: initiator[${event.data.initiator}],
        MessageOutEvent: from[${event.data.from}],
        MessageOutEvent: to[${to}],
        MessageOutEvent: amount[${event.data.amount}],
        MessageOutEvent: gasLimit[${event.data.gasLimit}],
        MessageOutEvent: swapData[${event.data.swapData}]
      `)
       let data = new Map()
       data.set("orderId", orderId)
       data.set("relay", event.data.relay)
       data.set("messageType", event.data.messageType)
       data.set("fromChain", event.data.fromChain)
       data.set("toChain", event.data.toChain)
       data.set("mos", mos)
       data.set("token", token)
       data.set("initiator", initiator)
       data.set("from", from)
       data.set("to", to)
       data.set("amount", event.data.amount)
       data.set("gasLimit", event.data.gasLimit)
       data.set("swapData", swapData)
       let dataStr = JSON.stringify(Object.fromEntries(data))
       var l:Log = {
         ChainId: this.cfg.id,
         EventId: 110,
         ProjectId: 1,
         TxHash: txHash,
         ContractAddres: this.cfg.opts.mcs,
         Topic: "MessageOutEvent",
         BlockNumber: trx?.slot || 0,
         BlockHash:"",
         TxIndex: 1,
         LogIndex: 1,
         LogData: dataStr,
         TxTimestamp:  trx?.blockTime || 0,
       }
       insertMos(l, (err:Error, id: number) => {
         if (err) {
           console.log("MessageOut Insert Failed, txHash:", txHash, "err:", err);
           return
         }
         console.log("MessageOut Insert Success, txHash:", txHash, "id:", id);
       })
    }

    convertHexToBtcAddress(hexStr: string): string {
      // 参数校验
      if (!hexStr.startsWith('0x') || hexStr.length < 4) {
        throw new Error('Hex string must start with 0x and have version prefix');
      }
    
      const versionHex = hexStr.substring(2, 4); // 提取版本标识
      const hashHex = hexStr.substring(4);       // 提取哈希部分
      const hash = Buffer.from(hashHex, 'hex');  // 转换为Buffer
    
      console.log(hexStr, " -hash.length ----- ", hash.length, " versionHex " , versionHex, " hashHex ", hashHex)
      // 根据版本号逆向转换
      switch (versionHex) {
        // P2PKH 
        case '01':
          if (hash.length === 20) {
            return address.toBase58Check(hash, 0x00); // Base58版本0
          } else if (hash.length === 32) { // Bech32 v1 
            return address.toBech32(hash, 1, 'bc'); // P2TR (Taproot)
          }
          throw new Error('P2PKH Or P2TR v0 requires 20 or 32-byte hash');
          
    
        // P2SH
        case '05':
          if (hash.length !== 20) throw new Error('P2SH requires 20-byte hash');
          return address.toBase58Check(hash, 0x05); // Base58版本5
    
        // Bech32 v0 
        case '00':
          if (hash.length === 20) {
            return address.toBech32(hash, 0, 'bc'); // P2WPKH
          } else if (hash.length === 32) {
            return address.toBech32(hash, 0, 'bc'); // P2WSH
          }
          throw new Error('Bech32 v0 requires 20 or 32-byte hash');
        default:
          throw new Error(`Unsupported version prefix: 0x${versionHex}`);
      }
    }

    isFirst12Zero(bytes: Uint8Array): boolean {
      return bytes.length >= 12 && 
         bytes.slice(0, 12).every(byte => byte === 0);
    }

}

function mergeArraysWithColon(arr1: string[], arr2: string[]): string[] {
  const minLength = Math.min(arr1.length, arr2.length);
  
  return Array.from({ length: minLength }, (_, i) => 
    `${arr1[i]}:${arr2[i]}`
  );
}

function parseMintAccount(data: Buffer): { decimals: number } {
  return {
    decimals: data.readUInt8(44),
  };
}

function hexToDecimalBigInt(hexStr: string): bigint {
  return BigInt(`0x${hexStr}`);
}

function toOneFollowedByZeros(n: number): bigint {
  return 10n ** BigInt(n);
}