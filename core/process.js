const ARGS = process.argv.slice(2);
const path = require('path');
const { spawn }  = require('child_process');
const pidusageTree = require('pidusage-tree');
const { performance } = require('perf_hooks');
const {
    checkIfProcessExists, 
    checkIfProcessFinishedCorrectly,
    printOSL, 
    processPidusageStats, 
    killProcess,
    parseTestOutput
} = require('./utils');

/**
 * @type {EnTest.Process[]}
 */
const PROCESSES = [];

/** Creates test process for particular Engine
 * @param {EnTest.EngineInfo} engine
 * @param {string} script
 * @param {function} callback
 * @return {EnTest.Process} Process
 */
function createProcess(engine, script, callback) {
    let stdout = '';
    let stderr = '';
    const childProcess = spawn(
        engine.path, 
        [script], 
        {},             // options
    );
    const process = {
        script: path.basename(script),
        engine: engine.name,
        childProcess,
        startTime: performance.now(),
        cpuVals: [],
        memVals: [],
        isTimedOut: false
    };

    PROCESSES.push(process);

    childProcess.stdout.on('data', (data) => {
        stdout += data;
    });
    childProcess.stderr.on('data', (data) => {
        stderr += data;
    });
    // https://nodejs.org/api/child_process.html#child_process_event_close
    childProcess.on('close', (code, signal) => { // If the process exited, code is the final exit code of the process, otherwise null. If the process terminated due to receipt of a signal, signal is the string name of the signal, otherwise null. One of the two will always be non-null.
        if (code !== 0) {
            const processEndResult = {
                code: code ? code : null,
                signal
            };
            handleExecFileResult(engine, script, processEndResult, stdout, stderr, callback);
        } else {
            handleExecFileResult(engine, script, null, stdout, stderr, callback);
        }
    });
    // https://nodejs.org/api/child_process.html#child_process_event_error
    childProcess.on('error', (err) => {
        if(err) {
            const processEndResult = {
                code: null,
                error: err
            };
            handleExecFileResult(engine, script, processEndResult, stdout, stderr, callback);
        }
    });

    return process;
}

/** Handle `pidusageTree` callback 
 * @param {string | Error} err
 * @param {EnTest.ProcessStats[]} stats
 * @return {EnTest.Process} p
 */

const pidUsageCallback = (err, stats, p) => {
    if( !checkIfProcessExists(p.childProcess) ) {
        return;
    } else if(err) {
        console.error(err);
        killProcess(p.childProcess, 'error');
        const idx = PROCESSES.findIndex(cp => cp.childProcess.pid === p.childProcess.pid);
        PROCESSES.splice(idx, 1);
        return;
    }
    false && console.log(stats);
    const [cpu, mem] = processPidusageStats(stats);
    p.cpuVals.push(cpu);
    p.memVals.push(mem);
    if(ARGS[0] === 'debug') {
        console.log(p.script, '\t', cpu, '\t', mem );
    } else {
        printOSL(`${p.script}\t${cpu}\t${mem}`);
    }
};

/** Handles results of test process execution
 * @param {EnTest.EngineInfo} engine 
 * @param {string} script - test script path
 * @param {EnTest.ProcessEndResult | null} err - error if process was ended with an error
 * @param {string} stdout - test process normal output
 * @param {string} stderr - test process errors output
 * @param {Function} callback - callback which should be called after test process end
 */
function handleExecFileResult (engine, script, err, stdout, stderr, callback) {
    const process = PROCESSES.pop();
    const [cpus, mems] = [process.cpuVals, process.memVals];
    if(!err && checkIfProcessFinishedCorrectly(process.childProcess)) {
        engine.testsPassed.push({
            script,
            stdout: parseTestOutput(engine.name, script, stdout),
            stderr,
            status: 'success',
            extime: performance.now() - process.startTime,
            stats: {
                cpus, mems,
                maxCPU: Math.max.apply(null, cpus),
                minCPU: Math.min.apply(null, cpus),
                maxMem: Math.max.apply(null, mems),
                minMem: Math.min.apply(null, mems),
            }
        });
    } else {
        engine.testsFailed.push({
            script,
            stdout: stdout.replace(/\n/g, ' '),
            stderr,
            status: process.isTimedOut 
                ? `timeout`
                : `error ${process.childProcess['exitCode'] || process.childProcess['signalCode']}`,
            extime: performance.now() - process.startTime,
            stats: {
                cpus, mems,
                maxCPU: Math.max.apply(null, cpus),
                minCPU: Math.min.apply(null, cpus),
                maxMem: Math.max.apply(null, mems),
                minMem: Math.min.apply(null, mems),
            }
        });    
    }
    if(engine.testsQueue.length == 0) {
        callback(engine);
    } else {
        createProcess(engine, engine.testsQueue.pop(), callback);
    }
}

/** Starts Processes Monitoring
 * @param {number} TIMEOUT 
 * @param {number} INTERVAL = 500 
 * @return {NodeJS.Timeout} intervalId 
 */
function startProcessesMonitoring(TIMEOUT, INTERVAL = 500) {
    return setInterval(() => {
        PROCESSES.forEach(cp => {
            if ( checkIfProcessExists(cp.childProcess) ) {
                if(performance.now() - cp.startTime < TIMEOUT) {
                    pidusageTree(cp.childProcess.pid, function(err, stats) {
                        pidUsageCallback(err, stats, cp);
                    }).catch((e) => {
                        if(cp.cpuVals.length + cp.memVals.length === 0) {
                            console.warn('#WARN: ', `${cp.engine}:${cp.script} test ended too quickly. CPU and Memory data will be not available.`);
                        }
                    });
                } else {
                    killProcess(cp.childProcess, `${cp.script} timeout`);
                    cp.isTimedOut = true;
                }
            }
        });
    },
    INTERVAL);
}

module.exports = {
    createProcess,
    startProcessesMonitoring
}