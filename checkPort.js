const net = require('net');

const port = 5000; // The port you're checking

function checkPort(port, callback) {
    const server = net.createServer();
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            callback(false); // Port is in use
        } else {
            callback(true); // Some other error, port is not in use
        }
    });

    server.once('listening', () => {
        server.close();
        callback(true); // Port is available
    });

    server.listen(port);
}

// Loop until the port is free or a timeout is reached
function waitForPort(port, timeout = 10000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
        function check() {
            checkPort(port, (available) => {
                if (available) {
                    resolve(true); // Port is available
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Port check timed out.'));
                } else {
                    setTimeout(check, 500); // Check again after 500ms
                }
            });
        }

        check();
    });
}

// Run the port check before starting Electron
waitForPort(port)
    .then(() => {
        console.log(`Port ${port} is now free. Starting Electron...`);
        process.exit(0); // Exit successfully
    })
    .catch((error) => {
        console.error(`Failed to wait for port ${port}:`, error.message);
        process.exit(1); // Exit with an error
    });
