
const readline = require('readline');
import * as stellarSDK from 'stellar-sdk'
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

const t = Date.now();
const UNLOCK_TIME_STRING = "2025-05-19 00:53:03"
const DUMMY_BUFFER_SECONDS = 10;
const PRESIGN_BUFFER_SECONDS = 0.5;
const TOTAL_DUMMIES = 5;
const MAX_REAL_TXS = 1;
const HORIZON_MAIN_URL = "https://api.mainnet.minepi.com"
const HORIZON_TEST_URL = 'https://api.testnet.minepi.com';
const MNEMONIC = process.env.MNEMONIC!;
const RECEIVER_MAIN = process.env.RECEIVER_ADDRESS_MAIN!;

const seed = bip39.mnemonicToSeedSync(MNEMONIC);
const derivationPath = "m/44'/314159'/0'";
const { key } = derivePath(derivationPath, seed.toString('hex'));
let sourceKeypair = stellarSDK.Keypair.fromRawEd25519Seed(key);
let sourcePublicKey = sourceKeypair.publicKey();
const server = new stellarSDK.Server(HORIZON_MAIN_URL);

console.log(`Sender Address: ${sourceKeypair.publicKey()} \n`);
console.log(`Receiver Address: ${RECEIVER_MAIN} \n`);

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

const unlockTime = new Date(UNLOCK_TIME_STRING);
const now = new Date();

if (now > unlockTime) {
    console.log("❌ Unlock time already passed.");
    process.exit(1);
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimAndMovePi() {
    let claimable = await server.claimableBalances()
        .claimant(sourcePublicKey)
        .limit(10)
        .order("asc")
        .call();

    if(!claimable.records.length) {
        console.log(`\n Unlock time is yet to reach`);
        return false;
    }
    console.log(`\n Wallet is claimable now\n`);
    console.log(claimable.records);

    let account = await server.loadAccount(sourcePublicKey);

    // let fee = await server.fetchBaseFee();
    const txBuilder = new stellarSDK.TransactionBuilder(account, {
        fee: (10_000_000).toString(),
        networkPassphrase: "Pi Network"
    });

    let transaction_hash: null | string = null;
    console.log(`\n Starting the claiming process now`);
    for(let record of claimable.records) {
        console.log("Adding claim operation for balance ID", record.id);

        txBuilder.addOperation(stellarSDK.Operation.claimClaimableBalance({
            balanceId: record.id,
            withMuxing: true
        }));

        txBuilder.addOperation(stellarSDK.Operation.accountMerge({
            destination: RECEIVER_MAIN
        }));

        console.log(`\n Building Transaction`);
        const transaction = txBuilder.setTimeout(20).build();
        console.log(`\n Signing Transaction`);
        transaction.sign(sourceKeypair);

        try {
            console.log(`\n Submiting Transaction`);
            const result = await server.submitTransaction(transaction);
            if(result.hash) console.log(`\nBalance Claimed`);
            transaction_hash = result.hash;
            console.log("Transaction submitted successfully", result.hash);
        } catch(err) {
            console.error("Transaction failed:", err.response?.data || err.message)
        }
    }

    return transaction_hash != null;
}

(async () => {
    let success = false;
    let max_retries = 10;
    let retries = 0;

    console.log("🚀 Pi Slot-Taking Started");
    const countdownInterval = setInterval(() => {
        const now = new Date();
        const timeToFinal = unlockTime.getTime() - now.getTime();

        if (timeToFinal <= 0) {
            clearInterval(countdownInterval);
        }

        printSameLine(`⏳ Bot To Launch At: ${formatCountdown(Math.max(timeToFinal, 0))}`);
    }, 1000);

    const finalDelay = unlockTime.getTime() - Date.now();
    console.log(`Final Milliseconds: ${finalDelay}`);
    setTimeout(async () => {
        do {
            console.log(`\n Started the Claiming and Moving Process`);
            success = await claimAndMovePi();
        } while(!success && retries < max_retries) {
            console.log(`\n Repeating Claiming and Moving Process ${retries} times`);
            success = await claimAndMovePi();
            await sleep(500);
            if(retries >= max_retries || success) {
                console.log(`Exiting process now after ${retries} tries.`)
                process.exit(1);
            }
        }
    }, finalDelay);
})();