const readline = require('readline');
import * as stellarSDK from 'stellar-sdk'
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const UNLOCK_TIME_STRING = "2025-05-18 19:52:11"
const DUMMY_BUFFER_SECONDS = 10;
const PRESIGN_BUFFER_SECONDS = 2;
const TOTAL_DUMMIES = 20;
const MAX_REAL_TXS = 5;
const HORIZON_MAIN_URL = "https://api.mainnet.minepi.com";
const HORIZON_TEST_URL = 'https://api.testnet.minepi.com';
const MNEMONIC = process.env.MNEMONIC!;
const RECEIVER_MAIN = process.env.RECEIVER_ADDRESS_MAIN!;
const RECEIVER_TEST = process.env.RECEIVER_ADDRESS!;
const ONTESTNET = false;
const FIXED_FEE = 1;
const AMOUNT_TO_WITHDRAW = 420.0;
let TXS: string[] = [];


const seed = bip39.mnemonicToSeedSync(MNEMONIC);
const derivationPath = "m/44'/314159'/0'";
const { key } = derivePath(derivationPath, seed.toString('hex'));
let sourceKeypair = ONTESTNET
  ? stellarSDK.Keypair.fromSecret('SD5WQM4HA3MERWGFMRBTP5KXPGGC4A5WEQMF5WZZRUFPVTC6S7BFEYMK')
  : stellarSDK.Keypair.fromRawEd25519Seed(key);

const server = new stellarSDK.Server(ONTESTNET ? HORIZON_TEST_URL : HORIZON_MAIN_URL);
const account = await server.loadAccount(sourceKeypair.publicKey());

console.log("\n🚨 Welcome To FriBot.");
console.log(`\n Sender Wallet Address - ${sourceKeypair.publicKey()}`);
console.log(`\n Sender Secret - ${sourceKeypair.secret()}`);

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


async function preSignTxs(acct = account,  withdrawal_amount = AMOUNT_TO_WITHDRAW) {
    // const account = await server.loadAccount(sourceKeypair.publicKey());

    let fee_percent = 2;
    for (let i = 0; i < MAX_REAL_TXS; i++) {
        let fee_factor = withdrawal_amount * 0.01 * (fee_percent * (i + 1));
        let fee = Math.floor(fee_factor * 10_000_000);
        let totalBalance = withdrawal_amount * 1e7;
        let maxSendAmount = (totalBalance - fee) / 1e7;

        const cloneAccount = new stellarSDK.Account(acct.accountId(), (BigInt(acct.sequence) + BigInt(i + 1)).toString());
        const tx = new stellarSDK.TransactionBuilder(cloneAccount, {
            fee: fee.toString(),
            networkPassphrase: "Pi Network",
        })
        .addOperation(stellarSDK.Operation.payment({
            destination: ONTESTNET ? RECEIVER_TEST : RECEIVER_MAIN,
            asset: stellarSDK.Asset.native(),
            amount: maxSendAmount.toString(),
        }))
        .setTimeout(30)
        .build();

        tx.sign(sourceKeypair);
        TXS.push(tx.toXDR());
    }
}

async function submitPreSignTxs() {
    let hash = null;
    await Promise.any(TXS.map(xdr =>
        server.submitTransaction(stellarSDK.TransactionBuilder.fromXDR(xdr, "Pi Network"))
    )).then(res => {
        console.log("✅ One TX sent successfully:", res.hash);
        hash = res.hash;
    }).catch(err => {
        console.log("⛔ All TXs failed:", err);
    });

    TXS = [];
    return hash != null;
}

function formatCountdown(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function printSameLine(text: string) {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(text);
}


async function submitDummyTransactions(account: stellarSDK.AccountResponse) {
    console.log("\n🚨 Submitting dummy transactions...");
    let hash;
    for(let i = 0; i < TOTAL_DUMMIES; i++) {
        const dummyTx = new stellarSDK.TransactionBuilder(account, {
            fee: (10 * i * 10000000).toString(),
            networkPassphrase: ONTESTNET ? 'Pi Testnet' : 'Pi Network',
        })
        .addOperation(stellarSDK.Operation.payment({
            destination: ONTESTNET ? RECEIVER_TEST : RECEIVER_MAIN,
            asset: stellarSDK.Asset.native(),
            amount: "0.0000001",
        }))
        .setTimeout(30)
        .build();
        dummyTx.sign(sourceKeypair);

        try {
            server.submitTransaction(dummyTx)
              .then(result => {
                    console.log(`\n No. ${i+1} Dummy TX sent ✅ — rivals using this sequence will now fail.`);
                    hash = result.hash;
              })
              sleep(550);
        } catch (e) {
            console.error("Dummy TX failed 🚫", e.response.data);
        }
    }
    return hash;
}

async function submitFinalTransaction(account: stellarSDK.AccountResponse) {
    console.log("🎯 Submitting final Pi transfer transaction... \n");
    const realTx = new stellarSDK.TransactionBuilder(account, {
        fee: (FIXED_FEE * 10000000).toString(),
        networkPassphrase: ONTESTNET ? 'Pi Testnet' : 'Pi Network',
    })
    .addOperation(stellarSDK.Operation.payment({
        destination: ONTESTNET ? RECEIVER_TEST : RECEIVER_MAIN,
        asset: stellarSDK.Asset.native(),
        amount: AMOUNT_TO_WITHDRAW.toFixed(7),
    }))
    .setTimeout(30)
    .build();
    
    realTx.sign(sourceKeypair);
    let hash = null;
    try {
        server.submitTransaction(realTx)
          .then(result => {
            console.log("Real TX sent ✅ — rivals using this sequence will now fail. \n");
            console.log("✅ Final transaction submitted. You’re in the race!\n");
            console.log(`\n ${JSON.stringify(result)}`)
            hash = result.hash;
          })
    } catch (e) {
        console.error("Real TX failed 🚫", e);
    }
    return hash != null;
}

// === MAIN ===
(async () => {
    const unlockTime = new Date(UNLOCK_TIME_STRING);
    const dummyStartTime = new Date(unlockTime.getTime() - DUMMY_BUFFER_SECONDS * 1000);
    const preSignStartTime = new Date(unlockTime.getTime() - PRESIGN_BUFFER_SECONDS * 1000);
    const now = new Date();

    if (now > unlockTime) {
        console.log("❌ Unlock time already passed.");
        process.exit(1);
    }

    console.log("🚀 Pi Slot-Taking Started");
    console.log(`🕒 Unlock Time (UTC): ${unlockTime.toISOString()}`);
    console.log(`📦 Dummy TXs start at: ${dummyStartTime.toISOString()}\n`);

    // Countdown loop
    const countdownInterval = setInterval(() => {
        const now = new Date();
        const timeToDummy = dummyStartTime.getTime() - now.getTime();
        const timeToFinal = unlockTime.getTime() - now.getTime();

        if (timeToFinal <= 0) {
            clearInterval(countdownInterval);
        }

        printSameLine(`⏳ Until Dummy: ${formatCountdown(Math.max(timeToDummy, 0))} | Until Final: ${formatCountdown(Math.max(timeToFinal, 0))}`);
    }, 1000);



    // Schedule dummy submission
    const dummyDelay = dummyStartTime.getTime() - Date.now();
    setTimeout(async () => {
        // await submitDummyTransactions(account);
    }, dummyDelay);

    // Schedule Presign transaction
    const presignDelay = preSignStartTime.getTime() - Date.now();
    setTimeout(async () => {
        await preSignTxs();
    }, presignDelay);

    function getBalance(account: stellarSDK.AccountResponse) {
        if(account) {
            const nativeBalanceEntry = account.balances.find(b => b.asset_type === 'native');
            if(nativeBalanceEntry) {
                return nativeBalanceEntry.balance;
            } else {
                console.log("Native balance not found");
                process.exit(1);
            }
        }
        return '0';
    }

    let lastChecked = 0;
    const throttle = 100;
    async function checkBalanceThrottled() {
        const now = Date.now();
        if (now - lastChecked < throttle) return null;

        lastChecked = now;
        const acct = await server.loadAccount(sourceKeypair.publicKey());
        const bal = getBalance(acct);
        return parseFloat(bal);
    }

  // Schedule final transaction submission
  const finalDelay = unlockTime.getTime() - Date.now();
  setTimeout(async () => {
    const MAX_TRIES = 100;
    let tries = 0;
    let success = false;
    while (!success && tries < MAX_TRIES) {
        console.log(`Sending Pi: ${tries} times(s)`);
        success = await submitPreSignTxs();
        if(!success) {
            const account = await server.loadAccount(sourceKeypair.publicKey());
            const current = await checkBalanceThrottled();
            console.log(`Balance now: ${current}`);
            // success = await submitFinalTransaction(account);
            // submitDummyTransactions(account);
            await preSignTxs(account, Number(current));
            await sleep(50);
        }
        tries++;
    }
  }, finalDelay);
})();

// 🔭 Live Monitor
server.payments()
  .forAccount(sourceKeypair.publicKey())
  .cursor('now')
  .stream({
    onmessage: (msg) => {
      console.log('📡 Incoming payment:', msg);
    },
    onerror: (err) => {
      console.error('Stream error:', err);
    }
  });