# KFul Proxy Server
A proxy server to load balance webpages or microservices with service discovery functionality

# npm
To install it in your proyect
```npm
npm install kful-proxy-server --save
```

# Features
* Proxy urls through this server.
* Discovery service to register services with a host and port.

# Quick start
```
let proxy = require('kful-proxy-server');
proxy.dirname = <path of the directory to save sockets address book>;
/* Default port: 80 or port in process.env.PORT */
/* Default list false, will use default socket list with true value */
proxy.runServer(3000, true)
```