import React from 'react';
import { createRoot } from 'react-dom/client';
import { WebsimSocket } from '@websim/db'; 

// Use a versioned collection name. Increment if schema changes or to reset test data scope.
const COLLECTION_NAME = 'stress_test_rows_v4'; 

// Global WebsimSocket instance with schema definition
const room = new WebsimSocket({
    schema: {
        [COLLECTION_NAME]: {
            id: "uuid", 
            value: "integer", 
            timestamp: "timestamptz" 
        }
    }
});

// Helper function to get records robustly
const getRecordsOnceRobust = (collectionName, timeoutMs = 2500) => {
    return new Promise((resolve) => {
        let resolved = false;
        let unsubscribeFn = () => {};

        const tryResolve = (records) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                if (typeof unsubscribeFn === 'function') { 
                    unsubscribeFn();
                }
                resolve(records);
            }
        };

        // Assign the actual unsubscribe function once subscription starts
        const unsubscribe = room.collection(collectionName).subscribe(records => {
            if (Array.isArray(records) && records.length > 0) {
                tryResolve(records);
            }
            // If records are empty, it might be initial state. We wait for either
            // a subsequent non-empty update or the main timeout.
        });
        if (typeof unsubscribe === 'function') {
            unsubscribeFn = unsubscribe;
        }


        const timeoutId = setTimeout(() => {
            const currentRecords = room.collection(collectionName).getList();
            tryResolve(Array.isArray(currentRecords) ? currentRecords : []); 
        }, timeoutMs);
    });
};


const App = () => {
    const [isTesting, setIsTesting] = React.useState(false);
    const [attemptedAdds, setAttemptedAdds] = React.useState(0);
    const [successfulAdds, setSuccessfulAdds] = React.useState(0);
    const [errorCount, setErrorCount] = React.useState(0);
    const [currentDelay, setCurrentDelay] = React.useState(10); 
    const [lastSuccessfulValue, setLastSuccessfulValue] = React.useState(0);
    const [lastError, setLastError] = React.useState('');
    const [logMessages, setLogMessages] = React.useState([]);
    const [manualStartInput, setManualStartInput] = React.useState('');


    const [dbRecordCount, setDbRecordCount] = React.useState(0);
    const [verificationStatus, setVerificationStatus] = React.useState('');
    const [minDbValue, setMinDbValue] = React.useState(null);
    const [maxDbValue, setMaxDbValue] = React.useState(null);
    const [missingCount, setMissingCount] = React.useState(0);
    const [uniqueUsernamesInTest, setUniqueUsernamesInTest] = React.useState(0);


    const testStateRef = React.useRef({
        running: false,
        currentValueToAdd: 0, 
        delay: 10, 
        consecutiveSuccesses: 0,
        timeoutId: null, 
    });

    const addLog = React.useCallback((message) => {
        const timestamp = new Date().toLocaleTimeString();
        setLogMessages(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 199)]);
    }, []);

    React.useEffect(() => {
        const initializeFromDB = async () => {
            addLog("Attempting to initialize from existing DB data...");
            try {
                const records = await getRecordsOnceRobust(COLLECTION_NAME);
                
                if (records && records.length > 0) {
                    const values = records
                        .map(r => r.value)
                        .filter(v => typeof v === 'number' && !isNaN(v));

                    if (values.length > 0) {
                        const maxVal = Math.max(...values);
                        setLastSuccessfulValue(maxVal);
                        testStateRef.current.currentValueToAdd = maxVal; 
                        addLog(`Initialized. Max value found in DB: ${maxVal}. Next add will be ${maxVal + 1} (unless overridden by manual start).`);
                    } else {
                        addLog("Initialized. No numeric 'value' field found in existing records. Starting from 0. Next add will be 1 (unless overridden).");
                        setLastSuccessfulValue(0);
                        testStateRef.current.currentValueToAdd = 0;
                    }
                } else {
                    addLog("Initialized. No existing records found or DB empty. Starting from 0. Next add will be 1 (unless overridden).");
                    setLastSuccessfulValue(0);
                    testStateRef.current.currentValueToAdd = 0;
                }
            } catch (error) {
                console.error("Error initializing from DB:", error);
                addLog(`Error during DB initialization: ${error.message}. Assuming start from 0.`);
                setLastSuccessfulValue(0);
                testStateRef.current.currentValueToAdd = 0;
            }
        };

        initializeFromDB();
    }, [addLog]);


    const runTestIteration = React.useCallback(async () => {
        if (!testStateRef.current.running) return;

        const valueToTry = testStateRef.current.currentValueToAdd + 1;
        setAttemptedAdds(prev => prev + 1);

        try {
            await room.collection(COLLECTION_NAME).create({ 
                value: valueToTry, 
                timestamp: new Date().toISOString() 
            });
            
            setSuccessfulAdds(prev => prev + 1);
            setLastSuccessfulValue(valueToTry); 
            testStateRef.current.currentValueToAdd = valueToTry; 
            testStateRef.current.consecutiveSuccesses++;

            if (testStateRef.current.consecutiveSuccesses >= 30) { 
                const oldDelay = testStateRef.current.delay;
                testStateRef.current.delay = Math.max(1, Math.floor(oldDelay * 0.9)); 
                if (oldDelay !== testStateRef.current.delay) { 
                   addLog(`Reduced delay to ${testStateRef.current.delay}ms after ${testStateRef.current.consecutiveSuccesses} successes.`);
                }
                setCurrentDelay(testStateRef.current.delay);
                testStateRef.current.consecutiveSuccesses = 0; 
            }
        } catch (error) {
            console.error("Error adding row:", error);
            setErrorCount(prev => prev + 1);
            setLastError(error.message);
            addLog(`Error adding value ${valueToTry}: ${error.message}.`);
            
            const oldDelay = testStateRef.current.delay;
            testStateRef.current.delay = Math.min(10000, Math.floor(oldDelay * 1.5 + Math.max(20, oldDelay * 0.1))); 
            if (oldDelay === testStateRef.current.delay && testStateRef.current.delay < 10000) { 
                testStateRef.current.delay += 1;
            }

            setCurrentDelay(testStateRef.current.delay);
            addLog(`Increased delay to ${testStateRef.current.delay}ms due to error (was ${oldDelay}ms).`);
            testStateRef.current.consecutiveSuccesses = 0;
        }

        if (testStateRef.current.running) {
            testStateRef.current.timeoutId = setTimeout(runTestIteration, testStateRef.current.delay);
        }
    }, [addLog]); 

    const handleStartTest = React.useCallback(async () => {
        addLog("Processing start test request...");
        
        let effectiveStartValueForLogic = lastSuccessfulValue; 
        const parsedManualInput = parseInt(manualStartInput);

        if (manualStartInput !== '' && !isNaN(parsedManualInput) && parsedManualInput >= 0) { 
            effectiveStartValueForLogic = parsedManualInput - 1;
            addLog(`Manual start: Test will attempt to add value ${parsedManualInput}. Internal 'previous value' set to ${effectiveStartValueForLogic}.`);
            setLastSuccessfulValue(effectiveStartValueForLogic); 
        } else {
            addLog(`Starting from last known/detected value. Next attempt will be ${lastSuccessfulValue + 1}.`);
        }
        
        testStateRef.current.currentValueToAdd = effectiveStartValueForLogic; 
        
        setIsTesting(true);
        testStateRef.current.running = true;
        testStateRef.current.delay = currentDelay; 
        testStateRef.current.consecutiveSuccesses = 0;
        setLastError('');
        addLog(`Test starting. Attempting to add values from ${testStateRef.current.currentValueToAdd + 1} onwards with initial delay ${testStateRef.current.delay}ms.`);

        runTestIteration();
    }, [addLog, runTestIteration, lastSuccessfulValue, currentDelay, manualStartInput]);

    const handleStopTest = React.useCallback(() => {
        addLog("Stopping test...");
        setIsTesting(false);
        testStateRef.current.running = false;
        if (testStateRef.current.timeoutId) {
            clearTimeout(testStateRef.current.timeoutId);
        }
    }, [addLog]);

    const handleResetStats = React.useCallback(() => {
        addLog("Resetting session stats and logs.");
        setAttemptedAdds(0);
        setSuccessfulAdds(0);
        setErrorCount(0);
        setLastError('');
        setLogMessages([]); 
        testStateRef.current.consecutiveSuccesses = 0;
    }, [addLog]);

    const handleVerify = React.useCallback(async () => {
        setVerificationStatus('Verifying...');
        addLog("Verification started...");
        try {
            const records = await getRecordsOnceRobust(COLLECTION_NAME);
            setDbRecordCount(records.length);
            addLog(`Verification: Found ${records.length} records in collection '${COLLECTION_NAME}'.`);

            const usernames = new Set();
            records.forEach(r => {
              if (r.username) usernames.add(r.username); 
            });
            setUniqueUsernamesInTest(usernames.size);

            if (records.length > 0) {
                const values = records.map(r => r.value).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
                
                if (values.length === 0) {
                     setMinDbValue(null);
                     setMaxDbValue(null);
                     setMissingCount(0);
                     setVerificationStatus(`Verified. ${records.length} records found, but no numeric 'value' field detected for sequence check.`);
                     addLog(`Verification: ${records.length} records, but no numeric 'value' field for sequence check.`);
                     return;
                }

                const minVal = values[0];
                const maxVal = values[values.length - 1];
                setMinDbValue(minVal);
                setMaxDbValue(maxVal);
                addLog(`Verification: Min value=${minVal}, Max value=${maxVal} (among ${values.length} numeric values).`);

                let missing = 0;
                const expectedCountInSequence = maxVal - minVal + 1;
                
                if (values.length < expectedCountInSequence) { 
                    const valueSet = new Set(values); 
                    for (let i = minVal; i <= maxVal; i++) {
                        if (!valueSet.has(i)) {
                            missing++;
                        }
                    }
                }
                setMissingCount(missing);
                addLog(`Verification: Found ${missing} missing values in the sequence from ${minVal} to ${maxVal}.`);
                setVerificationStatus(`Verified. ${records.length} records. Values: [${minVal}-${maxVal}]. Missing in seq: ${missing}. Users: ${usernames.size}.`);

            } else {
                setMinDbValue(null);
                setMaxDbValue(null);
                setMissingCount(0);
                setUniqueUsernamesInTest(0);
                setVerificationStatus('Verified. 0 records found.');
                addLog('Verification: 0 records found.');
            }
        } catch (error) {
            console.error("Error verifying records:", error);
            setVerificationStatus(`Error during verification: ${error.message}`);
            addLog(`Error during verification: ${error.message}`);
        }
    }, [addLog]);

    React.useEffect(() => {
        return () => {
            if (testStateRef.current.running) {
                handleStopTest(); 
            }
        };
    }, [handleStopTest]); 

    return (
        <div>
            <h1>Database Stress Test</h1>
            <div className="stats">
                <div className="input-group">
                    <label htmlFor="manualStartValue">Start Adding Value From: </label>
                    <input 
                        type="number" 
                        id="manualStartValue"
                        value={manualStartInput} 
                        onChange={e => setManualStartInput(e.target.value)}
                        placeholder="e.g., 1 (or blank)"
                        disabled={isTesting}
                        min="0"
                    />
                </div>
                <div>
                    <button onClick={handleStartTest} disabled={isTesting}>Start Test</button>
                    <button onClick={handleStopTest} disabled={!isTesting}>Stop Test</button>
                    <button onClick={handleResetStats} disabled={isTesting}>Reset Session Stats</button>
                </div>
                <div><strong>Status:</strong> {isTesting ? `Testing (next: ${testStateRef.current.currentValueToAdd + 1})...` : 'Stopped'}</div>
                <div><strong>Attempted Adds:</strong> {attemptedAdds}</div>
                <div><strong>Successful Adds:</strong> {successfulAdds}</div>
                <div><strong>Last Successful Value Added:</strong> {lastSuccessfulValue}</div>
                <div><strong>Errors:</strong> {errorCount}</div>
                <div><strong>Current Delay:</strong> {currentDelay}ms</div>
                {lastError && <div className="error"><strong>Last Error:</strong> {lastError}</div>}
            </div>

            <h2>Verification</h2>
            <div className="stats">
                <div><button onClick={handleVerify} disabled={isTesting}>Verify Records in DB</button></div>
                <div><strong>Verification Status:</strong> {verificationStatus}</div>
                <div><strong>Total Records in DB (<code>{COLLECTION_NAME}</code>):</strong> {dbRecordCount}</div>
                {minDbValue !== null && <div><strong>Min Value in DB:</strong> {minDbValue}</div>}
                {maxDbValue !== null && <div><strong>Max Value in DB:</strong> {maxDbValue}</div>}
                {maxDbValue !== null && <div><strong>Missing values in sequence [{minDbValue}-{maxDbValue}]:</strong> {missingCount}</div>}
                {dbRecordCount > 0 && <div><strong>Unique users contributing:</strong> {uniqueUsernamesInTest}</div>}
            </div>

            <h2>Logs</h2>
            <div className="log-area">
                {logMessages.length === 0 && <div>Logs will appear here...</div>}
                {logMessages.map((msg, index) => <div key={index}>{msg}</div>)}
            </div>
        </div>
    );
};

const reactRoot = createRoot(document.getElementById('root'));
reactRoot.render(<App />);