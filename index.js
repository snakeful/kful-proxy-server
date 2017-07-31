'use require';
const http = require('http');
const proxyServer = require('http-proxy');
const fs = require('fs');
const express = require('express');
const app = express();
const appRouter = express.Router();
const ifaces = require('os').networkInterfaces();
app.use(require('helmet')());
app.use(require('cors')());
app.use(require('body-parser').json());
app.use(require('compression')());
app.use('/api', appRouter);
app.dirname = __dirname;
app.configDir = 'config';
app.adbFile = 'sockets-adb.json';

let useDefaultList = false;
let proxyPort;
let socketList;
function runServer (port, useDefScktList = false) {
  readSockets();
  proxyPort = parseInt(port || process.env.PORT || 80);
  app.proxyPort = proxyPort;
  if (!app.discoveryPort) {
    app.discoveryPort = app.proxyPort + 1;
  }
  server.listen(proxyPort, () => {
    console.log(`Proxy server on port ${app.proxyPort}`);
  });
  app.listen(app.discoveryPort, () => {
    console.log(`Server on port ${app.discoveryPort}`);
  });
};

function getConfigDir () {
  return `${app.dirname}/${app.configDir}`;
};

function getConfigFile () {
  return `${app.dirname}/${app.configDir}/${app.adbFile}`;
};

function readSockets () {
  try {
    if (!fs.existsSync(getConfigDir())) {
      fs.mkdirSync(getConfigDir());
    }
    if (!fs.existsSync(getConfigFile())) {
      fs.writeFileSync(getConfigFile(), JSON.stringify({
        default: {
          sockets: [],
          curr: 0
        }
      }));
    }
    socketList = JSON.parse(fs.readFileSync(getConfigFile(), 'utf8'));
    console.log('Sockets loaded.');
  } catch (ex) {
    throw ex;
  }
};

function writeSockets () {
  try {
    fs.writeFileSync(getConfigFile(), JSON.stringify(socketList));
    console.log('Sockets saved.');
  } catch (ex) {
    throw ex;
  }
};

function sendError(res, err) {
    res.writeHeader(500);
    res.write(JSON.stringify({
      error: err
    }));
    res.end();
};

function checkServiceHealth(options) {
  let http = require('http');
  return new Promise((resolve, reject) => {
    let req = http.request(options, (res) => {
      res.on('data', (data) => {
        console.log(`Data: ${data}`);
      });

      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
          return reject(res);
        }
        resolve();
      });
    });
    req.on('error', (error) => {
      reject({
        message: error
      });
    });
    req.end();
  });
};

// Get the ipv4 address from which the server is running
Object.keys(ifaces).forEach((ifname) => {
  ifaces[ifname].forEach((iface) => {
    if (!app.host && iface.family === 'IPv4' && iface.internal) {
      app.ipAddress4 = iface.address;
    }
    if (!app.host && iface.family === 'IPv6' && iface.internal) {
      app.ipAddress6 = iface.address;
    }
  });
});

let proxy = proxyServer.createProxyServer({});
const server = http.createServer((req, res) => {
  try {
    if (['OPTIONS', 'HEAD'].indexOf(req.method) !== -1) {
      let headers = {};
      headers['access-control-allow-origin'] = '*';
      headers['access-control-allow-headers'] = 'Content-Type, Content-Length, Authorization, Accept, X-Request-With, x-socket-id';
      headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      res.writeHeader(200, headers);
      return res.end();
    }

    let sockets = socketList[req.headers['x-socket-id'] || 'default'];
    if (!sockets && (useDefaultList === 'true')) {
      sockets = socketList['default'];
    }
    if (!sockets) {
      res.writeHeader(404, res.headers)
      res.write(JSON.stringify({
        error: req.headers['x-socket-id'] ? `Socket Id ${req.headers['x-socket-id']} not found.` : 'Socket id for proxying not sent on headers x-socket-id.'
      }));
      return res.end();
    }
    sockets.curr = (sockets.curr + 1) % sockets.sockets.length;
    let target = sockets.sockets[sockets.curr];
    let address = req.socket.remoteAddress.split(':');
    function proxyTarget () {
      proxy.web(req, res, {
        target: target
      }, (err) => {
        console.log(`Error: ${JSON.stringify(err, null, ' ')}`);
        sendError(res, err);
      });
    }
    console.log(`${address[address.length - 1]}:${req.socket.remotePort} fowarding to ${target.host}:${target.port}`);
    checkServiceHealth({
      host: target.host,
      port: target.port,
      path: '/api/status'
    }).then(() => {
      proxyTarget();
    }, (err) => {
      sendError(res, `Cannot check health for service on ${target.host}:${target.port}. Error: ${err.message}`);
    });
  } catch (ex) {
    sendError(res, ex.message);
  }
});

appRouter.get('/status', (req, res) => {
  res.send();
});

appRouter.get('/sockets', (req, res) => {
  res.json(socketList);
});

appRouter.get('/sockets/:id', (req, res) => {
  if (!socketList[req.params.id]) {
    return res.status(404).send('Sockets not found.');
  }
  res.json(socketList[req.params.id]);
});

appRouter.post('/sockets', (req, res) => {
  if (!req.body || (req.body && (!req.body.host || !req.body.port))) {
    return res.status(404).json({
      err: 'Socket not sent. Payload structure: {"host":"<host>", "port": <port>}'
    });
  }
  let sockets = socketList[req.headers['x-socket-id'] || 'default'];
  if (!sockets) {
    sockets = {
      sockets: [],
      curr: 0
    };
    socketList[req.headers['x-socket-id'] || 'default'] = sockets;
  }
  let exist = false;
  sockets.sockets.forEach((socket) => {
    if ((socket.host === req.body.host) && (socket.port === parseInt(req.body.port))) {
      exist = true;
    }
  });
  if (!exist) {
    sockets.sockets.push({
      host: req.body.host,
      port: parseInt(req.body.port)
    });
  }
  res.status(200).send(true);
  writeSockets();
});

// Must send like query params host and port
appRouter.delete('/sockets', (req, res) => {
  if (!req.query.host || !req.query.port) {
    let error = {
      error: `Socket host or port not sent.`
    };
    return res.status(400).json();
  }
  let sockets = socketList[req.headers['x-socket-id'] || 'default'];
  let found = false;
  if (!sockets) {
    return res.status(404).json({
      error: `Socket not found ${req.headers['x-socket-id']}`
    });
  }
  sockets.sockets.forEach((socket, index) => {
    if ((socket.host === req.query.host) && (socket.port === parseInt(req.query.port))) {
      sockets.sockets.splice(index, 1);
      found = true;
      writeSockets();
    }
  });
  sockets.curr = sockets.sockets.length;
  res.status(found ? 200 : 404).send(found || `Socket ${req.query.host}:${req.query.port} not found.`);
});

module.exports = {
  app: app,
  runServer: runServer
};