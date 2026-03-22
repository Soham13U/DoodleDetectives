import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket() {
  return socket;
}

export function connectSocket(serverUrl: string) {
  if (socket) return socket;
  socket = io(serverUrl, {
    transports: ["websocket"],
    reconnection: true,
    autoConnect: true,
  });
  return socket;
}

export function disconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function emitWithAck<TReq, TRes>(event: string, payload?: TReq): Promise<TRes> {
  return new Promise((resolve) => {
    const s = getSocket();
    if (!s) return resolve({ ok: false, error: "SOCKET_NOT_READY" } as TRes);
    if (payload === undefined) {
      s.emit(event, (res: TRes) => resolve(res));
    } else {
      s.emit(event, payload, (res: TRes) => resolve(res));
    }
  });
}
