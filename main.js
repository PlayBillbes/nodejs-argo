// Node.js equivalents for Deno imports, converted to ES module syntax
import fs from 'fs/promises'; // For file system operations (async/await)
import http from 'http'; // For creating HTTP server
import net from 'net'; // For TCP sockets
import crypto from 'crypto'; // For crypto.randomUUID()
import { WebSocketServer } from 'ws'; // For WebSocket server

// Environment variables (Node.js uses process.env)
const envUUID = process.env.UUID || 'e5185305-1984-4084-81e0-f77271159c62';
const proxyIP = process.env.PROXYIP || '';
const credit = process.env.CREDIT || 'NodeBy-ModsBots';

const CONFIG_FILE = 'config.json';
const USAGE_FILE = 'usage.json'; // File for local data usage storage

/**
 * Interface for configuration, similar to Deno's TypeScript interface.
 * @typedef {Object} Config
 * @property {string} [uuid] - The UUID string.
 */

// In-memory map to store accumulated byte usage per user
const userByteCounters = new Map();
// Interval for flushing data to local file (in milliseconds)
const FLUSH_INTERVAL = 10 * 1000; // 10 seconds

/**
 * Checks if a file exists at the given path.
 * @param {string} path - The path to the file.
 * @returns {Promise<boolean>} True if the file exists, false otherwise.
 */
async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the UUID from the config.json file.
 * @returns {Promise<string | undefined>} The UUID if found and valid, otherwise undefined.
 */
async function getUUIDFromConfig() {
  if (await fileExists(CONFIG_FILE)) {
    try {
      const configText = await fs.readFile(CONFIG_FILE, 'utf8');
      const config = JSON.parse(configText);
      if (config.uuid && isValidUUID(config.uuid)) {
        console.log(`Loaded UUID from ${CONFIG_FILE}: ${config.uuid}`);
        return config.uuid;
      }
    } catch (e) {
      console.warn(`Error reading or parsing ${CONFIG_FILE}:`, e.message);
    }
  }
  return undefined;
}

/**
 * Saves the given UUID to the config.json file.
 * @param {string} uuid The UUID to save.
 */
async function saveUUIDToConfig(uuid) {
  try {
    const config = { uuid: uuid };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`Saved new UUID to ${CONFIG_FILE}: ${uuid}`);
  } catch (e) {
    console.error(`Failed to save UUID to ${CONFIG_FILE}:`, e.message);
  }
}

/**
 * Reads total data usage from the local usage.json file.
 * @param {string} userId The ID of the user whose usage to retrieve.
 * @returns {Promise<number>} The total bytes used, or 0 if the file doesn't exist or is invalid.
 */
async function getUsageFromLocalFile(userId) {
  if (await fileExists(USAGE_FILE)) {
    try {
      const usageText = await fs.readFile(USAGE_FILE, 'utf8');
      const usageData = JSON.parse(usageText);
      // Assuming usage.json stores an object where keys are user IDs
      // and values are their total bytes used.
      return usageData[userId] || 0;
    } catch (e) {
      console.warn(`Error reading or parsing ${USAGE_FILE}:`, e.message);
    }
  }
  return 0;
}

/**
 * Saves total data usage to the local usage.json file.
 * @param {string} userId The ID of the user whose usage to save.
 * @param {number} totalBytes The total bytes used to save.
 */
async function saveUsageToLocalFile(userId, totalBytes) {
  let usageData = {};
  if (await fileExists(USAGE_FILE)) {
    try {
      const usageText = await fs.readFile(USAGE_FILE, 'utf8');
      usageData = JSON.parse(usageText);
    } catch (e) {
      console.warn(`Error reading existing ${USAGE_FILE} for update:`, e.message);
      // If parsing fails, start with an empty object to prevent data corruption
      usageData = {};
    }
  }
  usageData[userId] = totalBytes;
  try {
    await fs.writeFile(USAGE_FILE, JSON.stringify(usageData, null, 2));
    console.log(`Saved total usage for ${userId} to ${USAGE_FILE}: ${totalBytes} bytes`);
  } catch (e) {
    console.error(`Failed to save usage to ${USAGE_FILE}:`, e.message);
  }
}

// Generate or load a random UUID once when the script starts
let userID;

if (envUUID && isValidUUID(envUUID)) {
  userID = envUUID;
  console.log(`Using UUID from environment: ${userID}`);
} else {
  const configUUID = await getUUIDFromConfig();
  if (configUUID) {
    userID = configUUID;
  } else {
    // Node.js crypto.randomUUID() requires Node.js v14.17.0+
    userID = crypto.randomUUID();
    console.log(`Generated new UUID: ${userID}`);
    await saveUUIDToConfig(userID);
  }
}

if (!isValidUUID(userID)) {
  throw new Error('uuid is not valid');
}

console.log(`Node.js Version: ${process.version}`);
console.log(`Final UUID in use: ${userID}`); // Log the final UUID for verification

/**
 * Updates the in-memory byte counter for a specific user.
 * @param {string} userId The ID of the user.
 * @param {number} bytes The number of bytes to add to the counter.
 */
function updateDataUsage(userId, bytes) {
  const currentBytes = userByteCounters.get(userId) || 0;
  userByteCounters.set(userId, currentBytes + bytes);
}

/**
 * Flushes accumulated data usage from in-memory counters to the local usage.json file.
 */
async function flushUsageData() {
  // Get the current total from the file system first
  const currentTotalBytesInFile = await getUsageFromLocalFile(userID);

  const accumulatedBytes = userByteCounters.get(userID) || 0;

  if (accumulatedBytes > 0) {
    const newTotalBytes = currentTotalBytesInFile + accumulatedBytes;
    await saveUsageToLocalFile(userID, newTotalBytes);
    userByteCounters.set(userID, 0); // Reset counter after successful flush
  }
}

// Start flushing data to local file periodically
setInterval(flushUsageData, FLUSH_INTERVAL);

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Handle HTTP requests
  switch (url.pathname) {
    case '/': {
      let dataUsageGB = 'Loading...';
      // Fetch data usage from local file
      try {
        const totalBytes = await getUsageFromLocalFile(userID);
        dataUsageGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);
      } catch (error) {
        console.error("Error fetching data usage from local file:", error);
        dataUsageGB = 'Error fetching';
      }

      const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Node.js Proxy</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background-color: #f0f2f5;
            color: #333;
            text-align: center;
            line-height: 1.6;
        }
        .container {
            background-color: #ffffff;
            padding: 40px 60px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            max-width: 600px;
            width: 90%;
        }
        h1 {
            color: #2c3e50;
            font-size: 2.8em;
            margin-bottom: 20px;
            letter-spacing: 1px;
        }
        p {
            font-size: 1.1em;
            color: #555;
            margin-bottom: 30px;
        }
        .button-container {
            margin-top: 30px;
        }
        .button {
            display: inline-block;
            background-color: #007bff;
            color: white;
            padding: 12px 25px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 1.1em;
            transition: background-color 0.3s ease, transform 0.2s ease;
            box-shadow: 0 4px 10px rgba(0, 123, 255, 0.2);
        }
        .button:hover {
            background-color: #0056b3;
            transform: translateY(-2px);
        }
        .footer {
            margin-top: 40px;
            font-size: 0.9em;
            color: #888;
        }
        .footer a {
            color: #007bff;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        .data-usage {
            margin-top: 25px;
            font-size: 1.2em;
            color: #34495e;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Node.js Proxy Online!</h1>
        <p>Your VLESS over WebSocket proxy is up and running. Enjoy secure and efficient connections.</p>
        <div class="data-usage">
            Your Data Usage: <span>${dataUsageGB} GB</span>
        </div>
        <div class="button-container">
            <a href="/${userID}" class="button">Get My VLESS Config</a>
        </div>
        <div class="footer">
            Powered by Node.js. For support, contact <a href="https://t.me/modsbots_tech" target="_blank">@modsbots_tech</a>.
        </div>
    </div>
</body>
</html>
        `;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
      break;
    }
    
    case `/${userID}`: {
      const hostName = url.hostname;
      const port = url.port || (url.protocol === 'https:' ? 443 : 80);
      const vlessMain = `vless://${userID}@${hostName}:${port}?encryption=none&security=tls&sni=${hostName}&fp=randomized&type=ws&host=${hostName}&path=%2F%3Fed%3D2048#${credit}`;      
      const ck = `vless://${userID}\u0040${hostName}:443?encryption=none%26security=tls%26sni=${hostName}%26fp=randomized%26type=ws%26host=${hostName}%26path=%2F%3Fed%3D2048%23${credit}`;
      // Note: The original Deno fetch to 'deno-proxy-version.deno.dev' is Deno-specific.
      // For Node.js, you might need a different mechanism or remove this if it's not critical.
      // If you need to make an external HTTP request, use Node.js's built-in 'node-fetch' or 'axios'.
      // For now, I'll keep the fetch call but it might not work as intended without the specific Deno endpoint.
      try {
        await fetch(new URL(`https://deno-proxy-version.deno.dev/?check=${ck}`));
      } catch (e) {
        console.warn("Failed to ping Deno version endpoint:", e.message);
      }


      // Clash-Meta config block (formatted for display)
      const clashMetaConfig = `
- type: vless
  name: ${hostName}
  server: ${hostName}
  port: ${port}
  uuid: ${userID}
  network: ws
  tls: true
  udp: false
  sni: ${hostName}
  client-fingerprint: chrome
  ws-opts:
    path: "/?ed=2048"
    headers:
      host: ${hostName}
`;

      const htmlConfigContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VLESS Configuration</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background-color: #f0f2f5;
            color: #333;
            text-align: center;
            line-height: 1.6;
            padding: 20px;
        }
        .container {
            background-color: #ffffff;
            padding: 40px 60px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            max-width: 800px;
            width: 90%;
            margin-bottom: 20px;
        }
        h1 {
            color: #2c3e50;
            font-size: 2.5em;
            margin-bottom: 20px;
            letter-spacing: 1px;
        }
        h2 {
            color: #34495e;
            font-size: 1.8em;
            margin-top: 30px;
            margin-bottom: 15px;
            border-bottom: 2px solid #eee;
            padding-bottom: 5px;
        }
        .config-block {
            background-color: #e9ecef;
            border-left: 5px solid #007bff;
            padding: 20px;
            margin: 20px 0;
            border-radius: 8px;
            text-align: left;
            position: relative;
        }
        .config-block pre {
            white-space: pre-wrap; /* Allows text to wrap */
            word-wrap: break-word; /* Breaks long words */
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
            font-size: 0.95em;
            line-height: 1.4;
            color: #36454F;
        }
        .copy-button {
            position: absolute;
            top: 10px;
            right: 10px;
            background-color: #28a745;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.9em;
            transition: background-color 0.3s ease;
        }
        .copy-button:hover {
            background-color: #218838;
        }
        .copy-button:active {
            background-color: #1e7e34;
        }
        .footer {
            margin-top: 20px;
            font-size: 0.9em;
            color: #888;
        }
        .footer a {
            color: #007bff;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        /* Modal Styles */
        .modal {
            display: none; /* Hidden by default */
            position: fixed; /* Stay in place */
            z-index: 1000; /* Sit on top */
            left: 0;
            top: 0;
            width: 100%; /* Full width */
            height: 100%; /* Full height */
            overflow: auto; /* Enable scroll if needed */
            background-color: rgba(0,0,0,0.4); /* Black w/ opacity */
            justify-content: center;
            align-items: center;
        }
        .modal-content {
            background-color: #fefefe;
            margin: auto;
            padding: 20px;
            border: 1px solid #888;
            width: 80%;
            max-width: 300px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 44px 8px rgba(0,0,0,0.2);
        }
        .modal-button {
            background-color: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 15px;
            transition: background-color 0.3s ease;
        }
        .modal-button:hover {
            background-color: #0056b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔑 Your VLESS Configuration</h1>
        <p>Use the configurations below to set up your VLESS client. Click the "Copy" button to easily transfer the settings.</p>

        <h2>VLESS URI (for v2rayN, V2RayNG, etc.)</h2>
        <div class="config-block">
            <pre id="vless-uri-config">${vlessMain}</pre>
            <button class="copy-button" onclick="copyToClipboard('vless-uri-config')">Copy</button>
        </div>

        <h2>Clash-Meta Configuration</h2>
        <div class="config-block">
            <pre id="clash-meta-config">${clashMetaConfig.trim()}</pre>
            <button class="copy-button" onclick="copyToClipboard('clash-meta-config')">Copy</button>
        </div>
    </div>

    <div id="messageModal" class="modal">
        <div class="modal-content">
            <p id="modalMessage"></p>
            <button class="modal-button" onclick="document.getElementById('messageModal').style.display = 'none'">OK</button>
        </div>
    </div>

    <script>
        function showMessage(message) {
            document.getElementById('modalMessage').innerText = message;
            document.getElementById('messageModal').style.display = 'flex'; // Use flex to center content
        }

        function copyToClipboard(elementId) {
            const element = document.getElementById(elementId);
            const textToCopy = element.innerText;
            // Use document.execCommand('copy') for broader compatibility in iframes
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showMessage('Configuration copied to clipboard!');
                } else {
                    throw new Error('execCommand was not successful');
                }
            } catch (err) {
                console.error('Failed to copy: ', err);
                showMessage('Failed to copy configuration. Please copy manually.');
            }
        }
    </script>
    <div class="footer">
        Powered by Node.js. For support, contact <a href="https://t.me/modsbots_tech" target="_blank">@modsbots_tech</a>.
    </div>
</body>
</html>
`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlConfigContent);
      break;
    }
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      break;
  }
});

// Create WebSocket server attached to the HTTP server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  // Only upgrade if the path is for the VLESS proxy (root path in this case for WS)
  // In your Deno code, the upgrade was handled if upgrade header was present,
  // here we also check if it's not a known HTTP path.
  if (request.headers.upgrade && request.headers.upgrade.toLowerCase() === 'websocket') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy(); // Destroy socket if not a WebSocket upgrade
  }
});

wss.on('connection', async (ws, request) => {
  // Similar to Deno's vlessOverWSHandler
  let address = '';
  let portWithRandomLog = '';
  const log = (info, event = '') => {
    console.log(`[${address}:${portWithRandomLog}] ${info}`, event);
  };

  // Node.js doesn't have 'sec-websocket-protocol' for early data in the same way Deno does
  // The Deno `earlyDataHeader` was used for 0-RTT. This is not directly supported in `ws` library.
  // For simplicity, we'll omit the earlyDataHeader processing for now.
  // If 0-RTT is critical, you'd need a more advanced WebSocket library or custom implementation.
  const earlyDataHeader = request.headers['sec-websocket-protocol'] || ''; // Still get it, but won't use for 0-RTT

  let remoteSocketWrapper = {
    value: null,
  };
  let udpStreamWrite = null;
  let isDns = false;

  ws.on('message', async (message) => {
    // Message can be Buffer, ArrayBuffer, or string
    const chunk = message instanceof Buffer ? message : Buffer.from(message);

    try {
      // Track data usage for incoming chunks (client to remote)
      updateDataUsage(userID, chunk.byteLength);

      if (isDns && udpStreamWrite) {
        return udpStreamWrite(chunk);
      }
      if (remoteSocketWrapper.value) {
        remoteSocketWrapper.value.write(chunk);
        return;
      }

      const {
        hasError,
        message: errMsg,
        portRemote = 443,
        addressRemote = '',
        rawDataIndex,
        vlessVersion = new Uint8Array([0, 0]),
        isUDP,
      } = processVlessHeader(chunk.buffer, userID); // Pass ArrayBuffer to processVlessHeader

      address = addressRemote;
      portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? 'udp ' : 'tcp '} `;

      if (hasError) {
        log(`VLESS header error: ${errMsg}`);
        ws.close(1000, errMsg); // Close WebSocket with an error code
        return;
      }

      if (isUDP) {
        if (portRemote === 53) {
          isDns = true;
        } else {
          log('UDP proxy only enabled for DNS (port 53)');
          ws.close(1000, 'UDP proxy only enabled for DNS (port 53)');
          return;
        }
      }

      const vlessResponseHeader = Buffer.from([vlessVersion[0], 0]);
      const rawClientData = chunk.slice(rawDataIndex);

      if (isDns) {
        console.log('isDns:', isDns);
        const { write } = await handleUDPOutBound(ws, vlessResponseHeader, log);
        udpStreamWrite = write;
        udpStreamWrite(rawClientData);
        return;
      }

      handleTCPOutBound(
        remoteSocketWrapper,
        addressRemote,
        portRemote,
        rawClientData,
        ws,
        vlessResponseHeader,
        log
      );
    } catch (err) {
      log('WebSocket message handling error:', err);
      ws.close(1011, 'Internal Server Error'); // 1011: internal error
    }
  });

  ws.on('close', () => {
    log('WebSocket closed');
    if (remoteSocketWrapper.value) {
      remoteSocketWrapper.value.destroy(); // Destroy remote TCP socket on WS close
    }
  });

  ws.on('error', (err) => {
    log('WebSocket error:', err);
    if (remoteSocketWrapper.value) {
      remoteSocketWrapper.value.destroy();
    }
  });
});

/**
 * Handles outbound TCP connections.
 * @param {object} remoteSocketWrapper - Wrapper to hold the net.Socket instance.
 * @param {string} addressRemote - The remote address to connect to.
 * @param {number} portRemote - The remote port to connect to.
 * @param {Buffer} rawClientData - The raw client data (e.g., TLS Client Hello) to write initially.
 * @param {WebSocket} ws - The WebSocket to pipe data to.
 * @param {Buffer} vlessResponseHeader - The VLESS response header to send back to the client.
 * @param {function} log - The logging function.
 */
async function handleTCPOutBound(
  remoteSocketWrapper,
  addressRemote,
  portRemote,
  rawClientData,
  ws,
  vlessResponseHeader,
  log
) {
  /**
   * Connects to the specified address and port, and writes the initial client data.
   * @param {string} address The target address.
   * @param {number} port The target port.
   * @returns {Promise<net.Socket>} The established TCP connection.
   */
  async function connectAndWrite(address, port) {
    return new Promise((resolve, reject) => {
      const tcpSocket = net.connect({ port: port, host: address }, () => {
        remoteSocketWrapper.value = tcpSocket;
        log(`connected to ${address}:${port}`);
        tcpSocket.write(rawClientData); // Write the initial client data.
        resolve(tcpSocket);
      });

      tcpSocket.on('error', (err) => {
        log(`TCP connection error to ${address}:${port}:`, err);
        reject(err);
      });
    });
  }

  /**
   * Retries the TCP connection, potentially using a proxy IP if available.
   */
  async function retry() {
    try {
      const tcpSocket = await connectAndWrite(proxyIP || addressRemote, portRemote);
      remoteSocketToWS(tcpSocket, ws, vlessResponseHeader, null, log);
    } catch (err) {
      log('Retry failed:', err);
      ws.close(1011, 'TCP retry failed');
    }
  }

  try {
    const tcpSocket = await connectAndWrite(addressRemote, portRemote);
    // Pipe data from remote TCP socket to WebSocket
    remoteSocketToWS(tcpSocket, ws, vlessResponseHeader, retry, log);
  } catch (err) {
    log('Initial TCP connection failed:', err);
    ws.close(1011, 'Initial TCP connection failed');
  }
}

/**
 * Pipes data from a remote TCP socket to a WebSocket.
 * @param {net.Socket} remoteSocket - The remote TCP connection.
 * @param {WebSocket} ws - The WebSocket to send data to.
 * @param {Buffer | null} vlessResponseHeader - The VLESS response header to send with the first chunk.
 * @param {(() => Promise<void>) | null} retry - A function to call if the remote socket has no incoming data initially.
 * @param {(info: string) => void} log - The logging function.
 */
function remoteSocketToWS(remoteSocket, ws, vlessResponseHeader, retry, log) {
  let hasIncomingData = false; // Flag to check if remoteSocket receives any data.

  remoteSocket.on('data', (chunk) => {
    hasIncomingData = true;
    // Track data usage for outgoing chunks (remote to client)
    updateDataUsage(userID, chunk.byteLength);

    if (ws.readyState === ws.OPEN) {
      if (vlessResponseHeader) {
        ws.send(Buffer.concat([vlessResponseHeader, chunk]));
        vlessResponseHeader = null; // Clear it after the first send
      } else {
        ws.send(chunk);
      }
    } else {
      log('WebSocket not open, cannot send data from remote');
      remoteSocket.destroy(); // Close remote socket if WS is not open
    }
  });

  remoteSocket.on('end', () => {
    log(`remoteSocket ended with hasIncomingData is ${hasIncomingData}`);
    if (ws.readyState === ws.OPEN) {
      ws.close(); // Close WebSocket when remote socket ends
    }
  });

  remoteSocket.on('error', (err) => {
    log('remoteSocket error:', err);
    if (ws.readyState === ws.OPEN) {
      ws.close(1011, 'Remote socket error');
    }
    // If no incoming data was received from the remote socket and a retry function is provided, attempt retry.
    if (hasIncomingData === false && retry) {
      log(`retry connection due to remote socket error`);
      retry();
    }
  });

  // If no incoming data was received from the remote socket and a retry function is provided, attempt retry.
  // This check is typically done after a timeout or when the remoteSocket.readable stream closes without data.
  // For Node.js net.Socket, the 'data' event indicates incoming data. If 'end' or 'close' happens without 'data',
  // then it means no incoming data. We handle retry within 'error' for immediate issues.
  // A timeout could be added here if a silent connection is considered a failure.
}

/**
 * Decodes a base64 string to an ArrayBuffer.
 * Handles URL-safe base64 (RFC 4648) by replacing '-' with '+' and '_' with '/'.
 * @param {string} base64Str The base64 string to decode.
 * @returns {{earlyData?: ArrayBuffer, error?: Error}} An object containing the decoded ArrayBuffer or an error.
 */
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    // Node.js Buffer handles URL-safe base64 directly
    const decodedBuffer = Buffer.from(base64Str, 'base64');
    // Convert Buffer to ArrayBuffer
    const arrayBuffer = decodedBuffer.buffer.slice(decodedBuffer.byteOffset, decodedBuffer.byteOffset + decodedBuffer.byteLength);
    return { earlyData: arrayBuffer, error: null };
  } catch (error) {
    return { error: error };
  }
}

/**
 * Performs a basic validation of a UUID string format using a regex.
 * This is for format checking, not cryptographic validation.
 * @param {string} uuid The UUID string to validate.
 * @returns {boolean} True if the UUID matches the expected format, false otherwise.
 */
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// WebSocket ready states (from ws library)
// const WS_READY_STATE_OPEN = 1; // ws.OPEN
// const WS_READY_STATE_CLOSING = 2; // ws.CLOSING

/**
 * Processes the VLESS header from the incoming ArrayBuffer.
 * It extracts connection details and validates the UUID.
 * @param {ArrayBuffer} vlessBuffer The ArrayBuffer containing the VLESS header.
 * @param {string} userID The expected UUID for validation.
 * @returns {object} An object containing connection details or an error.
 */
function processVlessHeader(vlessBuffer, userID) {
  // Minimum VLESS header length check.
  if (vlessBuffer.byteLength < 24) {
    return {
      hasError: true,
      message: 'invalid data: VLESS header too short',
    };
  }
  const version = new Uint8Array(vlessBuffer.slice(0, 1)); // VLESS protocol version.
  let isValidUser = false;
  let isUDP = false;

  // Validate UUID (bytes 1-16 of the header).
  if (stringify(new Uint8Array(vlessBuffer.slice(1, 17))) === userID) {
    isValidUser = true;
  }
  if (!isValidUser) {
    return {
      hasError: true,
      message: 'invalid user: UUID mismatch',
    };
  }

  const optLength = new Uint8Array(vlessBuffer.slice(17, 18))[0]; // Length of optional data.
  // Options are skipped for now based on the original logic.

  const command = new Uint8Array(vlessBuffer.slice(18 + optLength, 18 + optLength + 1))[0]; // Command byte.

  // Command types: 0x01 TCP, 0x02 UDP, 0x03 MUX.
  if (command === 1) {
    // TCP command.
  } else if (command === 2) {
    isUDP = true; // UDP command.
  } else {
    return {
      hasError: true,
      message: `command ${command} is not support, command 01-tcp,02-udp,03-mux`,
    };
  }

  const portIndex = 18 + optLength + 1;
  const portBuffer = vlessBuffer.slice(portIndex, portIndex + 2);
  // Port is big-endian (network byte order).
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(vlessBuffer.slice(addressIndex, addressIndex + 1));

  // Address type: 1 (IPv4), 2 (Domain Name), 3 (IPv6).
  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = '';

  switch (addressType) {
    case 1: // IPv4
      addressLength = 4;
      addressValue = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join('.');
      break;
    case 2: // Domain Name
      addressLength = new Uint8Array(vlessBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1; // Move past the length byte.
      addressValue = new TextDecoder().decode(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: // IPv6
      addressLength = 16;
      const dataView = new DataView(vlessBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16)); // Convert each 16-bit segment to hex.
      }
      addressValue = ipv6.join(':');
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty for addressType: ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType,
    portRemote,
    rawDataIndex: addressValueIndex + addressLength, // Index where raw client data begins.
    vlessVersion: version,
    isUDP,
  };
}

// Helper arrays for efficient UUID stringification.
const byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}

/**
 * Converts a Uint8Array to a UUID string without validation.
 * Used internally for stringifying parts of the VLESS header.
 * @param {Uint8Array} arr The Uint8Array containing the UUID bytes.
 * @param {number} offset The starting offset in the array.
 * @returns {string} The UUID string.
 */
function unsafeStringify(arr, offset = 0) {
  return (
    byteToHex[arr[offset + 0]] +
    byteToHex[arr[offset + 1]] +
    byteToHex[arr[offset + 2]] +
    byteToHex[arr[offset + 3]] +
    '-' +
    byteToHex[arr[offset + 4]] +
    byteToHex[arr[offset + 5]] +
    '-' +
    byteToHex[arr[offset + 6]] +
    byteToHex[arr[offset + 7]] +
    '-' +
    byteToHex[arr[offset + 8]] +
    byteToHex[arr[offset + 9]] +
    '-' +
    byteToHex[arr[offset + 10]] +
    byteToHex[arr[offset + 11]] +
    byteToHex[arr[offset + 12]] +
    byteToHex[arr[offset + 13]] +
    byteToHex[arr[offset + 14]] +
    byteToHex[arr[offset + 15]]
  ).toLowerCase();
}

/**
 * Converts a Uint8Array to a UUID string and validates its format.
 * Throws an error if the format is invalid.
 * @param {Uint8Array} arr The Uint8Array containing the UUID bytes.
 * @param {number} offset The starting offset in the array.
 * @returns {string} The validated UUID string.
 */
function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset);
  if (!isValidUUID(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }
  return uuid;
}

/**
 * Handles outbound UDP connections.
 * Currently, this function only supports DNS over HTTPS (DoH) by forwarding DNS queries to 1.1.1.1.
 * @param {WebSocket} ws - The WebSocket to send DNS responses back to.
 * @param {Buffer} vlessResponseHeader - The VLESS response header to send with the first DNS response.
 * @param {(string)=> void} log - The logging function.
 * @returns {{write: (chunk: Buffer) => void}} An object with a write method for the UDP stream.
 */
async function handleUDPOutBound(ws, vlessResponseHeader, log) {
  let isVlessHeaderSent = false;

  // Node.js does not have TransformStream directly like Deno's Web Streams API.
  // We'll manually parse the UDP packets from the incoming buffer.
  const write = async (chunk) => {
    // UDP message format: 2 bytes length + UDP data
    for (let index = 0; index < chunk.byteLength;) {
      const lengthBuffer = chunk.slice(index, index + 2);
      const udpPacketLength = lengthBuffer.readUInt16BE(0); // Read 2 bytes as big-endian
      const udpData = chunk.slice(index + 2, index + 2 + udpPacketLength);
      index = index + 2 + udpPacketLength;

      try {
        // Send DNS query to Cloudflare's DNS over HTTPS (1.1.1.1).
        const resp = await fetch('https://1.1.1.1/dns-query', {
          method: 'POST',
          headers: {
            'content-type': 'application/dns-message',
          },
          body: udpData, // Send the UDP data as the body
        });
        const dnsQueryResultBuffer = Buffer.from(await resp.arrayBuffer()); // Get the DNS response as a Buffer
        const udpSize = dnsQueryResultBuffer.byteLength;
        
        // Create a 2-byte buffer for the UDP packet length.
        const udpSizeBuffer = Buffer.alloc(2);
        udpSizeBuffer.writeUInt16BE(udpSize, 0);

        if (ws.readyState === ws.OPEN) {
          log(`doh success and dns message length is ${udpSize}`);
          // Track data usage for DNS responses (outgoing)
          updateDataUsage(userID, udpSize); 

          // Send VLESS response header with the first DNS response, then just the UDP data.
          if (isVlessHeaderSent) {
            ws.send(Buffer.concat([udpSizeBuffer, dnsQueryResultBuffer]));
          } else {
            ws.send(Buffer.concat([vlessResponseHeader, udpSizeBuffer, dnsQueryResultBuffer]));
            isVlessHeaderSent = true;
          }
        }
      } catch (error) {
        log('dns udp has error:' + error);
        if (ws.readyState === ws.OPEN) {
          ws.close(1011, 'DNS lookup error'); // Close WebSocket on DNS error
        }
      }
    }
  };

  return { write };
}

// Listen on port 8080 (or any other desired port)
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Node.js VLESS proxy server listening on port ${PORT}`);
});
