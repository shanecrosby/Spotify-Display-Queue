// ==== SET UP EXTERNAL REFERENCE MODULES ====
const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
// const http = require('http');
const net = require('net'); // Import the net module for checking the server
const fs = require('fs');

// ==== SET UP CONFIG FILE PATH =====
const configFile = "appconfig.json";
const configPath = path.join("E:", configFile); // E: for Dev, C: for Prod

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


// ==== READ CONFIG FILE AND ASSIGN VALUES ====
// Read the CONFIG file - config.json

console.log(`main.cjs config file path ${configPath}`);
console.log(`config file path ${configPath}`);

let config;
try {
    config = JSON.parse(fs.readFileSync(configPath), 'utf8');
} catch (error) {
    log.error('Failed to read config.json:', error);
    app.quit();
}

// Assign the config values
const port = config.port || 3000; // Default to 3000 if not specified

// Set global variables
let mainWindow;
let serverInstance;


//==== EXECUTE THE APPLICATION ====
app.whenReady().then(async () => {
    await startServer();
    await createWindow();

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
            createWindow();
        }
    });
});


  
// ==== APP CENTRAL FUNCTIONS ====

// Function start the server.cjs
async function startServer() {
    const isDev = process.env.NODE_ENV === 'development';
    log.info(`main.cjs startServer ${process.env.NODE_ENV}`);

    if (!isDev) {
        log.info('main.cjs !isDev - Starting Express server in the same process');

        // Run the server directly and assign the server instance
        serverInstance = require('./appserver.cjs');

        // Pause for 5 seconds before checking if the server is up
        await delay(5000);

        const serverRunning = await isServerRunning(port);
        log.info(`Server running: ${serverRunning}`);
    }
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
    } catch {
        console.error('main.cjs - error with serverInstance.close()', err)
    }
});


// Function that initiates the server application
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: config.windowWidth || 600,
        height: config.windowHeight || 720,
        frame: false, // Remove the window frame.
        transparent: true, // Enable transparency.
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        fullscreen: false,
        autoHideMenuBar: false
    });

    const startUrl = `http://localhost:${port}/login`;

    log.info(`main.cjs before .loadURL(startUrl) ${startUrl}`);
    mainWindow.loadURL(startUrl).catch(err => log.error('Failed to load URL:', err));

    mainWindow.on('ready-to-show', () => {
        log.info('main.cjs Window is ready to show');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        log.error('main.cjs Failed to load:', errorDescription);
    });

    mainWindow.webContents.on('did-finish-load', () => {
        log.info('main.cjs Page finished loading');
    });

    mainWindow.setMenuBarVisibility(false);

    // mainWindow.webContents.openDevTools();
}

// ==== UTILITY FUNCTIONS ====
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
// Function to check if the server is already running
async function isServerRunning(port) {
    return new Promise((resolve) => {
        const serverCheck = net.createConnection({ port }, () => {
          serverCheck.end();
          log.info(`main.cjs isServerRunning - TRUE`);
          resolve(true);
        });
    
        serverCheck.on('error', () => {
          log.info(`main.cjs isServerRunning - FALSE`);
          resolve(false);
        });
    });
}