const proxyServer = require('./index.js');
let args = process.argv.splice(2);
console.log('Running from testing');
proxyServer.runServer(args[0], args[1]);