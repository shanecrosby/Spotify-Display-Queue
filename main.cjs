// ==== SET UP EXTERNAL REFERENCE MODULES ====
require('dotenv').config(); //allows storing sensitive strings like API keys in .env file to be excluded from github.
const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
// const http = require('http');
const net = require('net'); // Import the net module for checking the server
const fs = require('fs');
const axios = require('axios');

// ==== SET UP CONFIG FILE PATH =====
function loadConfig() {
    const configFile = "appconfig.json";
    const configPath = path.join(__dirname, configFile); // __dirname for relative path instead of hard-coded location

    // ==== READ CONFIG FILE AND ASSIGN VALUES ====
    // Read the CONFIG file - config.json
    console.log(`main.cjs > config file path ${configPath}`);
    console.log(`config file path ${configPath}`);

    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath), 'utf8');

        // Replace variables in appconfig with actual environment variables
        config.spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
        config.spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        log.info('main.cjs > SPOTIFY_CLIENT_ID:', process.env.SPOTIFY_CLIENT_ID);
        log.info('main.cjs > SPOTIFY_CLIENT_SECRET:', process.env.SPOTIFY_CLIENT_SECRET);
    } catch (error) {
        log.error('Failed to read config.json:', error);
        app.quit();
    }

    return config;
}

// ==== SET UP LOGGING TO A FILE ====
const log = require('electron-log');
console.log = log.info;
console.error = log.error;
console.warn = log.warn;
console.debug = log.debug;
console.silly = log.silly;

// Properly configure electron-log
log.transports.file.level = 'info';
log.transports.file.file = path.join(app.getPath('userData'), 'logs/appmain.log');
log.info('log file path is ',log.transports.file.file);

// Set global variables and read the config file
let mainWindow;
let serverInstance;
const appConfig = loadConfig();
process.env.NODE_ENV = process.env.NODE_ENV || 'development';


// Assign the config values
const port = appConfig.port || 3000; // Default to 3000 if not specified
const startUrl = `http://localhost:${port}/login`;
if(!appConfig.spotifyClientId) {
    log.error('Environment variable file containing Spotify Client ID and API key is missing. Unable to start.');
    app.quit(); // Gracefully quit the app
    process.exit(1); // Exit with a non-zero status code.
}

//==== EXECUTE THE APPLICATION ====
app.whenReady().then(async () => {
    await startServer();
    await createWindow(appConfig);

    // Set up Short Keys
    globalShortcut.register('Ctrl+Shift+M', () => {
        const isVisible = mainWindow.isMenuBarVisible();
        mainWindow.setMenuBarVisibility(!isVisible);
        mainWindow.setAutoHideMenuBar(isVisible);
    });

    globalShortcut.register('Ctrl+Shift+F', () => {
        const isFullScreen = mainWindow.isFullScreen();
        mainWindow.setFullScreen(!isFullScreen);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(appConfig);
        }
    });
});

// ==== APP CENTRAL FUNCTIONS ====

// Function start the server (appServer.cjs)
async function startServer() {
    const isDev = process.env.NODE_ENV === 'development';
    log.info(`main.cjs > startServer ${process.env.NODE_ENV}`);

    if (!isDev) {
        log.info('main.cjs > !isDev - Starting Express server in the same process');

        // Check that the server isn't already running, restart if it is
        try {
            // Run the server directly and assign the server instance
            if (serverInstance) {
                serverInstance.close(() => {
                    log.info('Previous server instance closed.');
                    initializeServer();
                });
            } else {
                initializeServer();
            }
        } catch (error) {
            log.error('Failed to start server', error);
            app.quit();
            process.exit(1);
        }
    }
}

function initializeServer() {
    try {
        serverInstance = require('./appserver.cjs');

        serverInstance.listen(port, async () => {
            log.info(`Server is running on port ${port}`);
            
            // Pause for 5 seconds before checking server is up using HTTP
            await delay(5000);
            const serverRunning = await isServerRunning(startUrl);
            log.info(`Server running: ${serverRunning}`);
        }).on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                log.warn(`Port ${port} is already in use, which is expected. Suppressing the error.`);
                // Optionally, perform other actions or just ignore the error
            } else {
                log.error('An error occurred:', err);
                app.quit();
                process.exit(1);
            }
        });

    } catch (error) {
        log.error('Failed to initialize server:', error);
        app.quit();
        process.exit(1);
    }

    // Optional: Log to check if the server is actually running
    delay(5000).then(async () => {
        const serverRunning = await isServerRunning(startUrl);
        log.info(`Server running: ${serverRunning}`);
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    try{
        if (serverInstance && typeof serverInstance.close === 'function') {
            serverInstance.close(() => {
                console.log('Server closed successfully');
            });
        }
    } catch (err) {
        log.error('main.cjs > error with serverInstance.close()', err);
    }
});


// Function that initiates the server application
async function createWindow(config) {
    log.info('Creating window with config:', config);

    mainWindow = new BrowserWindow({
        width: config.windowWidth || 650, //650 is the fallback in case it is missing from the config file
        height: config.windowHeight || 720, //720 is the fallback in case it is missing from the config file
        frame: false, // Remove the window frame.
        transparent: false, // Enable transparency.
        backgroundMaterial: 'acrylic', // Apply acrylic background blur in Windows
        vibrancy: 'under-window', // Apply background blur on MacOS
        webPreferences: {
            //preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        fullscreen: false,
        autoHideMenuBar: false
    });

    

    log.info(`main.cjs > before .loadURL(startUrl) ${startUrl}`);
    mainWindow.loadURL(startUrl).catch(err => log.error('Failed to load URL:', err));

    mainWindow.on('ready-to-show', () => {
        log.info('main.cjs > Window is ready to show');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        log.error('main.cjs > Failed to load:', errorDescription);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        log.info('main.cjs > Page finished loading');
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.webContents.setVibrancy(under-window); // Blur background in MacOS
    mainWindow.webContents.setBackgroundMaterial("acrylic"); // Blur background in Windows
    //mainWindow.webContents.openDevTools(); //for debugging purposes only
}

// ==== UTILITY FUNCTIONS ====
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to check if the server is already running
async function isServerRunning(url) {
    try {
        const response = await axios.get(url);
        log.info(`main.cjs > isServerRunning: Server responded with status ${response.status}`);
        return true; //Server is running and responding
    } catch (error) {
        if (error.response) {
            // Server responded with status other than 2xx
            log.warn(`main.cjs > Server responded with status: ${error.response.status}`);
        } else if (error.request) {
            log.warn('main.cjs > No response received from the server.');
        } else {
            // Something weird happened in setting up the request
            log.error(`main.cjs > Error in isServerRunning: ${error.message}`);
        }
        return false; // Server is not running.
    }
    // return new Promise((resolve) => {
    //     const serverCheck = net.createConnection({ port }, () => {
    //         serverCheck.end();
    //         log.info(`main.cjs > isServerRunning = TRUE`);
    //         resolve(true);
    //     });
    
    //     serverCheck.on('error', () => {
    //         log.info(`main.cjs > isServerRunning = FALSE`);
    //         resolve(false);
    //     });
    // });
}