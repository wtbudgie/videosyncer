import express, { Request, Response } from "express";
import { RawData, WebSocket, WebSocketServer } from "ws";
import http from "http";
import path from "path";
import fs from "fs";
import readline from "readline";

const createContentFolder = () => {
  const dir = path.join(process.cwd(), "content");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
    console.log("Created 'content' folder.");
  }
  return dir;
};

const promptUserToSelectFile = (dir: string) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  fs.readdir(dir, (err, files) => {
    if (err) {
      console.error("Could not list the files.", err);
      process.exit(1);
    }

    if (files.length === 0) {
      console.log("No files found in the 'content' folder.");
      rl.close();
      process.exit(1);
    }

    console.log("Select a file from the following:");
    files.forEach((file, index) => {
      console.log(`${index + 1}: ${file}`);
    });

    rl.question(
      "Enter the number of the file you want to select: ",
      (answer) => {
        const selectedIndex = parseInt(answer, 10) - 1;

        if (selectedIndex < 0 || selectedIndex >= files.length) {
          console.log("Invalid selection. Exiting.");
          rl.close();
          process.exit(1);
        }

        const selectedFile = files[selectedIndex];
        console.log(`You selected: ${selectedFile}`);
        rl.close();
        promptUserForPort(selectedFile);
      }
    );
  });
};

const promptUserForPort = (selectedFile: string) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("Enter the port number (default is 1234): ", (answer) => {
    const port = answer.trim() !== "" ? parseInt(answer, 10) : 1234;
    console.log(`Using port: ${port}`);
    rl.close();
    startServer(selectedFile, port);
  });
};

let masterSocket: WebSocket | null = null;
const receivers: WebSocket[] = [];

function getDirPath() {
  // @ts-ignore
  if (process.pkg) {
    return path.resolve(process.execPath + "/..");
  } else {
    return path.join(require.main ? require.main.path : process.cwd());
  }
}

const startServer = (selectedFile: string, port: number) => {
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer });

  app.get("/", (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, "live.html"));
  });

  app.use(express.static(path.join(getDirPath(), "content")));

  wss.on("connection", (ws: WebSocket) => {
    console.log("Client connected");

    if (!masterSocket) {
      masterSocket = ws;
      console.log("Master assigned.");

      const response = {
        command: "source",
        src: `http://localhost:${port}/${selectedFile}`,
        role: "master",
      };
      ws.send(JSON.stringify(response));
    } else {
      receivers.push(ws);
      console.log("Receiver added.");

      const response = {
        command: "source",
        src: `http://localhost:${port}/${selectedFile}`,
        role: "receiver",
      };
      ws.send(JSON.stringify(response));
    }

    ws.on("message", (data: RawData) => {
      const message = data.toString();

      if (masterSocket && ws === masterSocket) {
        const syncMessage = {
          command: "sync",
          timestamp: message,
        };
        receivers.forEach((receiver) => {
          receiver.send(JSON.stringify(syncMessage));
        });
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      if (ws === masterSocket) {
        console.log("Master disconnected.");
        masterSocket = null;

        if (receivers.length > 0) {
          masterSocket = receivers[0];
          const index = receivers.indexOf(masterSocket);
          if (index !== -1) {
            receivers.splice(index, 1);
            console.log("Master removed from receivers.");
          }

          console.log("New master assigned.");

          const newMasterMessage = {
            command: "newMaster",
            src: `http://localhost:${port}/${selectedFile}`,
          };
          receivers.forEach((receiver) => {
            if (receiver === masterSocket) return;
            receiver.send(JSON.stringify(newMasterMessage));
          });

          const response = {
            command: "source",
            src: `http://localhost:${port}/${selectedFile}`,
            role: "master",
          };

          masterSocket.send(JSON.stringify(response));
        }
      } else {
        const index = receivers.indexOf(ws);
        if (index !== -1) {
          receivers.splice(index, 1);
          console.log("Receiver removed.");
        }
      }
    });

    ws.on("error", console.error);
  });

  httpServer.listen(port, () => {
    console.log(
      `Syncer service started: Accessible by displays on: http://127.0.0.1:${port}`
    );
  });
};

const contentDir = createContentFolder();
promptUserToSelectFile(contentDir);
