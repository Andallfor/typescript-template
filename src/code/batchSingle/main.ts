import { NS } from '@ns';
import { distribute, weakenThreadsNeeded } from 'code/batchSingle/util';
import { BATCH_INTERVAL, BATCH_STEP, distributeResults } from './constants';
import { attackType, getScript } from '../util/util';

// does not require formulas but will only perform one saturated batch attack at a time
// TODO: for simplicity we assume home does not have any cores
export async function main(ns: NS) {
    ns.disableLog('ALL');

    const flags = ns.flags([
        ['p', 0.5], // percent to hack
        ['h', false], // can use home server (will leave HOME_RESERVED untouched)
        ['s', -1], // max batch saturation
    ]);

    const target = (flags['_'] as string[])[0];
    if (!ns.serverExists(target)) {
        ns.tprint(`ERROR: Invalid server ${target}`);
        ns.exit();
    }

    const percent = flags['p'] as number;
    const includeHome = flags['h'] as boolean;
    const saturation = flags['s'] as number;

    ns.setTitle(`Batch - ${target} (p=${percent} s=${saturation})`);
    ns.tail();

    await prep(ns, target, includeHome);

    while (true) {
        const length = ns.getWeakenTime(target); // under count (no BATCH_SIZE * 2) for safety
        let sat = Math.floor(length / BATCH_INTERVAL);
        if (saturation != -1) sat = Math.min(sat, saturation);

        ns.print(`Starting cycle with a saturation of ${sat}`);

        let runTime = 0;
        for (let i = 0; i < sat; i++) {
            const hackAmt = ns.getServerMaxMoney(target) * percent;
            const hack = Math.floor(ns.hackAnalyzeThreads(target, hackAmt));
            const weakOne = weakenThreadsNeeded(ns, ns.hackAnalyzeSecurity(hack));
            const grow = Math.ceil(ns.growthAnalyze(target, ns.getServerMaxMoney(target) / Math.max(ns.getServerMaxMoney(target) - hackAmt, 1)));
            const weakTwo = weakenThreadsNeeded(ns, ns.growthAnalyzeSecurity(grow));

            const dist = distribute(ns, hack, weakOne, grow, weakTwo, includeHome);
            if (!dist) {
                ns.tprint(`ERROR: Unable to run batch step (${i} batches are active)`);
                ns.exit();
            }

            const [t, _] = deploy(ns, dist, target);
            runTime = t;

            await ns.sleep(BATCH_INTERVAL);
        }

        await ns.sleep(runTime);
        ns.print(`Completed cycle r=${ns.tFormat(runTime)}`);
        await prep(ns, target, includeHome);
    }
}

async function prep(ns: NS, target: string, includeHome: boolean) {
    const minSec = ns.getServerMinSecurityLevel(target);
    const curSec = ns.getServerSecurityLevel(target);
    const maxMon = ns.getServerMaxMoney(target);
    const curMon = ns.getServerMoneyAvailable(target);

    if (minSec == curSec && maxMon == curMon) {
        ns.print("Server is already prepared, skipping");
        return;
    }

    // need to fix both money and security
    const weakOne = weakenThreadsNeeded(ns, curSec - minSec);
    let grow = 0;
    let weakTwo = 0;

    // check if we need to increase money as well
    if (maxMon != curMon) {
        grow = Math.ceil(ns.growthAnalyze(target, ns.getServerMaxMoney(target) / ns.getServerMoneyAvailable(target)));
        weakTwo = weakenThreadsNeeded(ns, ns.growthAnalyzeSecurity(grow, target));
    }

    const toDeploy = distribute(ns, 0, weakOne, grow, weakTwo, includeHome);
    if (!toDeploy) {
        ns.tprint("ERROR: Unable to prepare server!");
        ns.exit();
    }

    const [n, _] = deploy(ns, toDeploy, target);
    ns.print(`Preparing ${target} in ${ns.tFormat(n)}`);
    await ns.sleep(n + 100);

    if (ns.getServerMaxMoney(target) == ns.getServerMoneyAvailable(target) &&
        ns.getServerMinSecurityLevel(target) ==ns.getServerSecurityLevel(target))
        ns.print("Successfully prepared server");
    else {
        ns.tprint("ERROR: Unable to prepare server");
        ns.exit();
    }
}

// returns length of attack, pids to watch
function deploy(ns: NS, res: distributeResults, target: string): [number, number[]] {
    function execute(attack: attackType, data: [string, number][], offset: number) {
        const script = getScript(attack);
        let pid = -1;
        data.forEach(([server, threads]) => {
            if (threads <= 0) return; // threads might be 0 or -1
            ns.scp(script, server);
            pid = ns.exec(script, server, threads, target, offset);
        });

        return pid;
    }

    const tHack = ns.getHackTime(target);
    const tGrow = ns.getGrowTime(target);
    const tWeak = ns.getWeakenTime(target);

    const hackOffset = tWeak - tHack - BATCH_STEP;
    const growOffset = tWeak - tGrow + BATCH_STEP;
    const weakTwoOffset = 2 * BATCH_STEP;

    return [tWeak + BATCH_STEP * 2, [
        execute('h', res.hack, hackOffset),
        execute('w', res.weakOne, 0),
        execute('g', [res.grow], growOffset),
        execute('w', res.weakTwo, weakTwoOffset)
    ]];
}
