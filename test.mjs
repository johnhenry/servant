// event-listener-server.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
// Import `fetch` from the same `undici` version as `Agent` below. Node's
// global `fetch` is backed by whatever undici is bundled with the running
// Node version; passing an `Agent` from a *different* undici version as its
// `dispatcher` throws `InvalidArgumentError: invalid onError method` because
// the internal dispatcher shapes are incompatible across versions.
import { Agent, fetch as undiciFetch } from "undici";
import WebSocket from "ws";
import genPort from "leserve/genport";
// Import the server implementation
import "./event.mjs";
import {
  start,
  stop,
  route,
  use,
  emit,
  createServerSentEvent,
} from "./controls.mjs";
addEventListener("start", ({ index, port }) =>
  console.log(`Server ${index} running on port ${port}.`)
);
addEventListener("start", ({ index }) =>
  console.log(`Server ${index} stopped.`)
);
addEventListener("error", ({ message }) =>
  console.error(`Server error: ${message}.`)
);
const isPortClosed = (port) => {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => {
      resolve(false);
    });
  });
};

/**
 * Send a raw HTTP request over a plain TCP socket and resolve with the
 * status line once the connection closes. Used to exercise request-lines
 * that `fetch()` itself would refuse to construct (e.g. a malformed
 * absolute-form URL), so we can confirm the server degrades to an error
 * response instead of crashing.
 */
const sendRaw = (port, rawRequest) => {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "localhost", () => {
      socket.write(rawRequest);
    });
    let data = "";
    socket.on("data", (chunk) => (data += chunk.toString()));
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for a response"));
    }, 5000);
  });
};

const execFileAsync = promisify(execFile);

const sseHandler = (event) => {
  if (event.request.url.endsWith("/sse")) {
    const ts = new TransformStream();
    const writer = ts.writable.getWriter();
    writer.write(createServerSentEvent({ message: "Hello SSE" }, "update"));
    writer.close();
    event.respondWith(
      new Response(ts.readable, {
        headers: {
          Connection: "keep-alive",
          "Content-Encoding": "none",
          "Cache-Control": "no-cache, no-transform",
          "Content-Type": "text/event-stream",
        },
      })
    );
    return;
  }
  event.respondWith(new Response("Not Found", { status: 404 }));
};

describe("Event Listener Server Tests", async () => {
  await test("Server start and stop", async () => {
    const port = await genPort();
    const server = await start({ port });
    try {
      await assert.doesNotReject(fetch(`http://localhost:${port}`));
    } finally {
      await stop(server);
    }
    const isClosed = await isPortClosed(port);
    assert.ok(
      isClosed,
      `Port ${port} should be closed after stopping the server`
    );
  });

  await test("HTTPS server", async () => {
    const port = await genPort();
    const httpsOptions = {
      key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDYhAyKc91hGMeG
G4hubHNVvqRRKUzKTiAvtJJAN99prmfi4QEwXSYjDbyGeBFa5RY09Q/Y5WZQxaEs
zzsrfTdlEYJx4LaWUF/0WrTHs4KW9RBXKY2eqska6bmGp2dRjQryXrCuTCvxEsOF
mG244IDho0OK/fuTqnlWzpGxs1n/rSZ33+FHksU3jt58Y1mq09o068gXu+4jjZeI
65pTC9HwGNYmk0L+sxfs4+8Dh/8NndfYImWB/+ydbiKuEwhKZKRVkjoltd+OIreo
E5/AcWd9DBIAlVa9gfiGIf77/XcUri7iYElzDwHHO655ed7VusvEO4NGFdGTpzPU
BYMhHaUvAgMBAAECggEAIzjYEW3n2vPSVtlZHcg8EFGDHvDpB8AjMZ+JFd6rqYrb
EOgpmVnjP7CXCrOy9GZwG7gCFqFlk549f1yhnjbbMXCNF+7Gb+LYuUJIRnRyuhFZ
Jyogr78jbWK4RlTVVJ7tOPXOfYxGrwuuYv1OXCpUImC84Xo6guXTTMaDTQqFiYyv
TrtviL2mFnJowoyFzToXky1KjN9CZh0aHcBm8uCXlXmL861btcLFpl9hnCADKZlR
O4aiK+Cz+b/0Sc0qwjcaudjpKyPK9c+cpaP5n8o26dg2ZnjpCmnE9OHmepB7H36T
z3xsE1rK6v0vWN5ajelngBxkRrNaX9BDSZFSRMMbgQKBgQD88G3CQP11qD9MWwpn
CS7tX0WrEXcoULHEO/ET5RO5SxdaWq9lH/jL0x5mJbBGQiOqffr4A7IuSVswqGLW
WEvquAHM6M9MMUk3TkiHesXKcQrI46SxCorfEE/TihcowRqoM25yfmL2+1cK8vQ8
KgpT3LjHCfd6ZwtKSz8i2YRZuwKBgQDbIskeSPzxVZslzA7atJmrE0JHK22Dvd5A
ynwkIC5mfWgoG/ZzX7mC0hAh4geiiXsR1IW89fl7GZUbBksr0D4xdeexp6anPPbE
3fDDZ0JP2tlzqXFdAckC9A43DjoNJHjPNtCmS/mP+Oe4YfNuo2Xu50oGkNd+zE47
IZKcMhVBHQKBgEs0uY3OgQ4grmFnmFo2csuFTlOk58cG5zQvlmiR7iFj4FevKwNo
VDNWXG2GuzjIpY4l0x83Ch2VFhYLmwecTUZG29IvTqOa6+gT0KDnsjOVFN3SQb+a
INxeHz4IiwZFFEX6tNY6GfbRmHna7x+MaHGy6QXVQs4UIVk/slAMWLvNAoGBALn3
ZlhWNpqUPKsx5jVCaNqe6HM/bpwLyI6RiBKcYORHbtoDCP5WcTeND3XBvRr5s0Cp
a6m10TffuQMLL0YKXo1Y8vx4O1zXxs/BTa52dfcQ0dNvK65zcmQYO+wLHcbDeebY
LO/DsBG3eOan8Y+mCT5aeB7kUozf01ApKKN3eUQdAoGAUjblOoxm/e5Rs1J8diP+
cGZEod/x2OsMyav3WbnZxpPvCBS6eZQ965wRzC0F0NWAEriyJaKOXiVkAl6e9rZo
aQTPZsd6nOrcvp3IfCB3Xpr+CneFJdweu2SCnL8ibnxDLGyAsGHQuen8tfPiD5z1
Qe29CWMTv9CaXbywovGU3Hg=
-----END PRIVATE KEY-----`,
      cert: `-----BEGIN CERTIFICATE-----
MIIDbTCCAlWgAwIBAgIUGvbCY7YYDX5zLie33gaYmvn+IaQwDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAgFw0yNDA4MjUwOTIyNTVaGA8yMTI0
MDgyNTA5MjI1NVowRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUx
ITAfBgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBANiEDIpz3WEYx4YbiG5sc1W+pFEpTMpOIC+0kkA3
32muZ+LhATBdJiMNvIZ4EVrlFjT1D9jlZlDFoSzPOyt9N2URgnHgtpZQX/RatMez
gpb1EFcpjZ6qyRrpuYanZ1GNCvJesK5MK/ESw4WYbbjggOGjQ4r9+5OqeVbOkbGz
Wf+tJnff4UeSxTeO3nxjWarT2jTryBe77iONl4jrmlML0fAY1iaTQv6zF+zj7wOH
/w2d19giZYH/7J1uIq4TCEpkpFWSOiW1344it6gTn8BxZ30MEgCVVr2B+IYh/vv9
dxSuLuJgSXMPAcc7rnl53tW6y8Q7g0YV0ZOnM9QFgyEdpS8CAwEAAaNTMFEwHQYD
VR0OBBYEFAOlT+T8sAwnkKJVLAJetvV3fqTHMB8GA1UdIwQYMBaAFAOlT+T8sAwn
kKJVLAJetvV3fqTHMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AHByIGXwJX95XcGlE+DW32AZgJLNKN3drFhzpVqSYZj0Pvzj7k2QdnqG1cqZT1ox
UBX4gc3+e7QX6uaoIqvKpYAob57ptTVCdL5cWf/sJBPC0oq/pIGsPystQur8a95t
jxd3lhTHQMBH5oCcZP0QHNK4R9W/Qgd/4Kf2OxYvXCWJ8MlTrjDNb6axH74fr9xx
nryPiuupyiwNGkYiF6Vvvq8wbQAMydDrPTl7gWMtYfHFjpNK5CRHvu2+2RCHOZD3
0iSlO/cL2MZnGQy5WaUIGXJmPyjFZmLt5XMdE8JUx7XrkowVWHfwWHm3RolUSsPM
VyyNz/1TUWii+PL9b9yswag=
-----END CERTIFICATE-----`,
    };
    const server = await start({ port, https: httpsOptions });
    try {
      await assert.doesNotReject(
        undiciFetch(`https://localhost:${port}`, {
          dispatcher: new Agent({
            connect: {
              rejectUnauthorized: false,
            },
          }),
        })
      );
    } finally {
      await stop(server);
    }
  });

  await test("Basic request handling", async () => {
    const port = await genPort();
    const BasicRequestHandler = (event) => {
      event.respondWith(new Response("Hello, World!", { status: 200 }));
    };
    addEventListener("fetch", BasicRequestHandler);
    const server = await start({ port });
    try {
      const response = await fetch(`http://localhost:${port}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "Hello, World!");
    } finally {
      removeEventListener("fetch", BasicRequestHandler);
      await stop(server);
    }
  });

  await test("Routing", async () => {
    const port = await genPort();
    route("GET", "/hello/:name", async (req, params) => {
      return new Response(`Hello, ${params.name}!`, { status: 200 });
    });

    const server = await start({ port });
    try {
      const response = await fetch(`http://localhost:${port}/hello/Alice`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "Hello, Alice!");
    } finally {
      await stop(server);
    }
  });

  await test("Middleware", async () => {
    const port = await genPort();
    let middlewareCalled = false;
    use(async (req, res) => {
      middlewareCalled = true;
      return req;
    });
    const middlewareHandler = (event) => {
      event.respondWith(new Response("Hello, World!", { status: 200 }));
    };

    addEventListener("fetch", middlewareHandler);

    const server = await start({ port });
    try {
      await fetch(`http://localhost:${port}`);
      assert.equal(middlewareCalled, true);
    } finally {
      removeEventListener("fetch", middlewareHandler);
      await stop(server);
    }
  });

  await test("WebSocket", async () => {
    const port = await genPort();
    const webSocketHandler = (ws) => {
      ws.on("message", (message) => {
        ws.send(`Echo: ${message}`);
      });
    };
    addEventListener("websocket", webSocketHandler);
    const server = await start({ port });
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.on("open", () => {
          ws.send("Hello, WebSocket!");
        });
        ws.on("message", (data) => {
          try {
            assert.equal(data.toString(), "Echo: Hello, WebSocket!");
            ws.close();
            resolve();
          } catch (err) {
            ws.close();
            reject(err);
          }
        });
        ws.on("error", reject);
      });
    } finally {
      removeEventListener("websocket", webSocketHandler);
      await stop(server);
    }
  });

  await test("Server-Sent Events", async () => {
    // TODO: can I use an EventSource Polyfill?
    const port = await genPort();
    addEventListener("fetch", sseHandler);
    const server = await start({ port });
    try {
      const response = await fetch(`http://localhost:${port}/sse`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "text/event-stream");
      const reader = response.body.getReader();
      const { value } = await reader.read();
      const eventData = new TextDecoder().decode(value);
      assert.match(
        eventData,
        /^event: update\ndata: {"message":"Hello SSE"}\n\n$/
      );
    } finally {
      removeEventListener("fetch", sseHandler);
      await stop(server);
    }
  });

  await test("Custom events", async () => {
    let customEventCalled = false;
    const customEventHandler = (data) => {
      customEventCalled = true;
      assert.deepEqual(data, { message: "Custom event data" });
    };
    addEventListener("customEvent", customEventHandler);

    emit("customEvent", { message: "Custom event data" });
    assert.equal(customEventCalled, true);
    removeEventListener("customEvent", customEventHandler);
  });

  await test("Error handling", async () => {
    const port = await genPort();
    const fetchHandler = () => {
      throw new Error("Test error");
    };
    addEventListener("fetch", fetchHandler);
    const server = await start({ port });
    const { promise: error, resolve: errorHandler } = Promise.withResolvers();
    addEventListener("error", errorHandler);
    try {
      const response = await fetch(`http://localhost:${port}`);
      assert.equal(response.status, 500);
      assert.equal(await response.text(), "Internal Server Error");
      assert.equal((await error).message, "Test error");
    } finally {
      removeEventListener("fetch", fetchHandler);
      removeEventListener("error", errorHandler);
      await stop(server);
    }
  });

  await test("a request-handler error does not crash the process when no 'error' listener is registered", async () => {
    // This test file registers a top-level `addEventListener("error", ...)`
    // listener (see above), so it can't exercise the "nobody is listening"
    // case in-process — Node's `EventEmitter` special-cases the "error"
    // event: emitting it with zero listeners *throws* instead of dropping
    // it. Since `start()`'s request handler used to call
    // `eventEmitter.emit("error", error)` unconditionally on every caught
    // exception, ANY thrown route/middleware/fetch-event error crashed the
    // entire process unless the library consumer happened to register an
    // error listener — which is optional. Spawn a bare child process that
    // never registers one, and confirm a thrown route handler still
    // degrades to a 500 response instead of taking the process down.
    const port = await genPort();
    const controlsUrl = JSON.stringify(new URL("./controls.mjs", import.meta.url).href);
    const script = `
      import { start, route } from ${controlsUrl};
      route("GET", "/boom", () => { throw new Error("boom"); });
      await start({ port: ${port} });
      const res = await fetch("http://localhost:${port}/boom");
      process.stdout.write(JSON.stringify({ status: res.status, body: await res.text() }));
      process.exit(0);
    `;
    const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script]);
    const result = JSON.parse(stdout);
    assert.equal(result.status, 500);
    assert.equal(result.body, "Internal Server Error");
  });

  await test("a malformed request-target returns an error response instead of crashing the process", async () => {
    const port = await genPort();
    // `start()` awaits `server.listen()`'s own callback before resolving,
    // so (unlike serve.mjs's `serve()`) there's no separate "wait until
    // actually listening" step needed here.
    const server = await start({ port });
    try {
      // A well-formed HTTP request line whose absolute-form target contains
      // invalid IPv6-bracket syntax. Node's HTTP parser accepts this and
      // hands it straight through as `req.url`, but the WHATWG `URL`
      // constructor throws on it. Regression for: `toWebRequest()` used to
      // be called *outside* the request handler's try/catch, so this single
      // request crashed the entire process instead of getting an error
      // response.
      const response = await sendRaw(
        port,
        "GET http://[::1:bad/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
      );
      assert.match(response, /^HTTP\/1\.1 400 /);

      // The process (and this server) must still be alive and serving.
      const res = await fetch(`http://localhost:${port}/`);
      assert.equal(res.status, 404);
    } finally {
      await stop(server);
    }
  });

  await test("repeated response headers (e.g. multiple Set-Cookie) are all sent, not just the last one", async () => {
    const port = await genPort();
    const cookieHandler = (event) => {
      const headers = new Headers();
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      event.respondWith(new Response("ok", { headers }));
    };
    addEventListener("fetch", cookieHandler);
    const server = await start({ port });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      assert.deepEqual(res.headers.getSetCookie().sort(), ["a=1", "b=2"]);
    } finally {
      removeEventListener("fetch", cookieHandler);
      await stop(server);
    }
  });

  await test("a response body stream that errors mid-response does not crash the process", async () => {
    const port = await genPort();
    const brokenStreamHandler = (event) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial-"));
          setTimeout(() => controller.error(new Error("upstream broke")), 20);
        },
      });
      event.respondWith(new Response(stream, { status: 200 }));
    };
    addEventListener("fetch", brokenStreamHandler);
    const server = await start({ port });
    try {
      const res = await fetch(`http://localhost:${port}/`);
      assert.equal(res.status, 200);
      await assert.rejects(res.text());

      // The process (and this server) must still be alive and serving.
      removeEventListener("fetch", brokenStreamHandler);
      const ok = await fetch(`http://localhost:${port}/`);
      assert.equal(ok.status, 404, "server must still accept and handle new requests");
    } finally {
      removeEventListener("fetch", brokenStreamHandler);
      await stop(server);
    }
  });
});
