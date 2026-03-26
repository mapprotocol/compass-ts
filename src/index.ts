import { delay } from './utils/time'
import { initAlarm } from './utils/alarm/slack'
import { parseConfig } from './config/config'
import { initChain } from './chain/chain'
import { initDb } from './storages/mysql/mysql'
import { Command } from "commander";

const version = (`1.0.0`)
const defCfgPath = "./config.json"

async function main() {
  // step1: flags
  const program = new Command();
  program.name("filter-ts").
    description("CLI to filter solana tracsaction log").
      version(version)
  program.option('-c, --config <>')
  program.parse(process.argv)
  const options = program.opts();
  let configPath = options.config
  if (configPath == "") {
    configPath = defCfgPath
  }
  console.log("Input config path is:", configPath)
  // step2: parse config
  let cfg = parseConfig(configPath)
  console.log("Parse config scuuess")
  // step 2.1 init alarm
  initAlarm(cfg.other.env, cfg.other.monitorUrl)
  // step3: init storage
  initDb(cfg.storages[0].user,cfg.storages[0].psw, cfg.storages[0].db,  cfg.storages[0].host, cfg.storages[0].port)
  console.log("Init db pool success")
  // step4: init chain
  let chains = initChain(cfg)
  console.log("Init chains success")
  // step5: filter
  for (let index = 0; index < chains.length; index++) {
    const element = chains[index];
    console.log("Chain  ", element.getName(), " start filter")
    element.sync()
  }
  console.log("Chains start filter success")
  // step6: sleep
  for (;;){
    await delay(3000)
  }
}

main()


// import {
//   Connection,
//   Keypair,
//   SystemProgram,
//   LAMPORTS_PER_SOL,
//   Transaction,
//   ConfirmOptions,
//   sendAndConfirmTransaction,
// } from "@solana/web3.js";
// import { buffer } from "stream/consumers";
 
// (async () => {
//   // 获取私钥
//   let firstWinWallet = Keypair.fromSecretKey(Uint8Array.from([137, 6, 244, 115, 223, 10, 189, 103, 177, 82, 236, 171, 86, 43, 233, 223, 198, 185, 16, 226, 222, 30, 15, 102, 60, 26, 1, 31, 83, 28, 1, 187, 17, 235, 155, 69, 221, 45, 201, 181, 27, 91, 48, 236, 60, 104, 110, 17, 33, 57, 150, 218, 142, 154, 186, 90, 100, 76, 245, 36, 29, 108, 70, 36]))
//   console.log("address ", firstWinWallet.publicKey.toString())
//   console.log("address ", firstWinWallet.publicKey.toString())

//   const connection = new Connection(
//     "https://mainnet.helius-rpc.com/?api-key=62295a13-b1a3-4490-bf32-7f271a344f53",
//     "confirmed",
//   );
 
//   const airdropSignature = await connection.requestAirdrop(
//       firstWinWallet.publicKey,
//       LAMPORTS_PER_SOL,
//   );
 
//   // 构建交易
//   let buf = Buffer.from("0100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800100091211eb9b45dd2dc9b51b5b30ec3c686e11213996da8e9aba5a644cf5241d6c46245a327cb1401183b3f49938f123cf144c392416a5d9421010e03fb0d27ea76d10719166788604864a09088b01d825377e63142ec004c248f12c8afe2d74048f790b044ad5a8091fe4074e2226063e1e0bb2d8c428fcd5f5b50b7e90fc2ac09dce4f6f511ee225590386555548df21787c3249d6fbee772684d80a3ebcd4a225e8699ccf6a754cc66bc60477c828c5c15bcd4f424868df5c916b080dd279bbc11ce55dc8bef30171231d55f4ac12e45150f25e84f20a4d071af04ea00f64ed7d10d299238d154b40bd94a45a751c0b982d6b48865c3fd5f2017a536fb2aecd5db3cbd59c12afdbcd637324d9362ad13eea48d71f129d6d937e88cd6d038d4e83e8961492fd172cf007394425b964e8642ee4c679d0eec16df7abf9ef0be95e89d2975353446b99f21fb5d0e3036431ea204e359cd3ea8ab2f31135e05c08886dd006ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a98c97258f4e2489f1bb3d1029148e0d830b5a1399daff1084048e7bd8dbe9f8590000000000000000000000000000000000000000000000000000000000000000b9233a435967c29a81443f5263906ce0839ae0e0c62ede1c74487875d33377110306466fe5211732ffecadba72c39be7bc8ce5bbc5f7126b2c439b3a400000000479d55bf231c06eee74c56ece681507fdb1b2dea3f48e5102b1cda256bc138fb43ffa27f5d7f64a74c09b1f295879de4b09ab36dfc9dd514b321aa7b38ce5e8f78927635ac31e6da4cdc0b0c0a25f8f6708edb5bc39782743a99f80e21dc81509090900010a0216030b0c0d182091f176585e65a76600000000000071dda88101000000000909000e0a1704050b0c0d10b712469c946da12268415e00000000000f000502c05c15000f00090304170100000000000c06000600160d0b0101101c0b00040610161011101812181314040616171518000b0b191807081023e517cb977ae3ad2a010000002664000168415e0000000000bc87890100000000c800000b0306000001090d0200010c02000000dda881010000000009040002010310b5e6bd156eec4b69660000000000007101708de64f8352a7bcf3f09396ba0d47e63d291c29739a743308e0a7d27871993b049f9e9def04a0f1f3a1", 'hex')
//   const tx = Transaction.from(buf)
//   // 签名
//   // send
//   let opt: ConfirmOptions = {
//     skipPreflight: false,
//     maxRetries: 5,
//     minContextSlot: 1
//   }
//   await sendAndConfirmTransaction(connection, tx, [
//       firstWinWallet,
//   ], opt);

// })();