// ultra-fast-pi-bot.ts
import 'dotenv/config';
import * as stellar from 'stellar-sdk';
const sodium = require('sodium-native');
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const ONTESTNET = false;

const HORIZON_MAIN = 'https://api.mainnet.minepi.com';
const HORIZON_TEST = 'https://api.testnet.minepi.com';
const server = new stellar.Server(ONTESTNET ? HORIZON_TEST : HORIZON_MAIN);

const MNEMONIC = process.env.MNEMONIC!;
const RECEIVER_MAIN = process.env.RECEIVER_ADDRESS_MAIN!;
const RECEIVER_TEST = process.env.RECEIVER_ADDRESS!;
const FIXED_FEE = 1; // 10,000,000 stroops
const MIN_LEFT = 2.0; // Amount to leave behind
const FIXED_AMOUNT_TO_SEND = '10';

const seed = bip39.mnemonicToSeedSync(MNEMONIC);
const derivationPath = "m/44'/314159'/0'";
const { key } = derivePath(derivationPath, seed.toString('hex'));
let keypair = ONTESTNET
  ? stellar.Keypair.fromSecret('SD5WQM4HA3MERWGFMRBTP5KXPGGC4A5WEQMF5WZZRUFPVTC6S7BFEYMK')
  : stellar.Keypair.fromRawEd25519Seed(key);
const publicKey = keypair.publicKey();

async function sendRemainingPi() {
  try {
    const account = await server.loadAccount(publicKey);
    const balanceStr = account.balances.find(b => b.asset_type === 'native')?.balance;
    if (!balanceStr) throw new Error('No native balance found');

    const sequenceNumber = BigInt(account.sequenceNumber());
    console.log(sequenceNumber)
    
    const balance = parseFloat(balanceStr);
    console.log(balance)
    const amountToSend = balance - 0.2;

    // if (amountToSend <= 0) {
    //   console.log(`❌ Not enough Pi to send. Balance: ${balance}, Needs > ${MIN_LEFT + FIXED_FEE}`);
    //   return false;
    // }

    // Optional: set 30-second timebound (safer retries)
    const currentTime = Math.floor(Date.now() / 1000);
    const timebounds = {
      minTime: currentTime.toString(),
      maxTime: (currentTime + 30).toString()
    };

    // === 1. DUMMY TX (to invalidate rivals)
  const dummyTx = new stellar.TransactionBuilder(account, {
    fee: (FIXED_FEE * 10000000).toString(),
    networkPassphrase: ONTESTNET ? 'Pi Testnet' : 'Pi Network',
  })
    .addOperation(stellar.Operation.payment({
      destination: ONTESTNET ? RECEIVER_TEST : RECEIVER_MAIN,
      asset: stellar.Asset.native(),
      amount: "0.0000001", // tiny amount to self
    }))
    .setTimeout(30)
    .build();

  // sodiumSignTx(dummyTx, keypair);
  dummyTx.sign(keypair);

  // Submit dummy TX
  try {
    await server.submitTransaction(dummyTx);
    console.log("Dummy TX sent ✅ — rivals using this sequence will now fail.");
  } catch (e) {
    console.error("Dummy TX failed 🚫", e);
    return false;
  }


    // Real Transaction

    const tx = new stellar.TransactionBuilder(account, {
      fee: (FIXED_FEE * 10000000).toString(),
      //timebounds, // 1000 stroops
      networkPassphrase: ONTESTNET ? 'Pi Testnet' : 'Pi Network',
    })
    // .addOperation(stellar.Operation.bumpSequence({
    //     bumpTo: (BigInt(account.sequenceNumber()) + 5n).toString(),
        
    //   }))
      .addOperation(
        stellar.Operation.payment({
          destination: ONTESTNET ? RECEIVER_TEST : RECEIVER_MAIN,
          asset: stellar.Asset.native(),
          amount: amountToSend.toFixed(7), // max 7 decimal places
        })
      )
      // .addMemo(stellar.Memo.text(PAYMENT_ID))
      
      .setTimeout(20)
      .build();

    // sodiumSignTx(tx, keypair);

    tx.sign(keypair);

    // server.payments().cursor('now').stream({
    //   onmessage: msg => console.log('Payment event:', msg)
    // });
    const result = await server.submitTransaction(tx);
    console.log(`✅ TX Successful! Hash: ${JSON.stringify(result)}`);
    return true;
  } catch (err: any) {
    console.error('❌ TX Error:', err?.response?.data?.extras?.result_codes || err.message);
    return false;
  }
}

// Main fast loop
(async () => {
  const MAX_TRIES = 103;
  let tries = 0;
  let success = false;
  while (!success && tries < MAX_TRIES) {
    success = await sendRemainingPi();
    tries++;
  }
})();

// 🔭 Live Monitor
server.payments()
  .forAccount(keypair.publicKey())
  .cursor('now')
  .stream({
    onmessage: (msg) => {
      console.log('📡 Incoming payment:', msg);
    },
    onerror: (err) => {
      console.error('Stream error:', err);
    }
  });
