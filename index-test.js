const proxyServer = require('./index.js');
let args = process.argv.splice(2);
console.log('Running from testing');
console.log(proxyServer.app.ipAddress4);
console.log(proxyServer.app.ipAddress6);
proxyServer.runServer(args[0], args[1]);