import { config } from "../config";
import axios from "axios";

interface Stream {
  name: string;
  id: string;
}

export async function getStreams(): Promise<Stream[]> {
  let res = await axios.get(`${config.url}/streams`);
  return res.data;
}

enum MsgType {
  SESSION_DESCRIPTION,
  ICE_CANDIDATE,
  STREAM_DESCRIPTION
}

interface Message {
  type: MsgType;
  payload: any;
}


function getSocket(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const websocket = new WebSocket(url);

    websocket.onopen = () => {
      resolve(websocket);
    };

    websocket.onerror = () => {
      reject();
    };
  });
}

export async function getStream(id: string): Promise<Stream> {
  let res = await axios.get(`${config.url}/streams/${id}`);
  return res.data;
}

export async function getVideoStream(id: string): Promise<[MediaStream, () => void]> {
  const socket = await getSocket(`${config.wsUrl}/streams/${id}/video`);

  const peer = new RTCPeerConnection({
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302"
      }
    ]
  });

  const mediaStreamPromise = new Promise<MediaStream>((resolve, _reject) => {
    console.log("handling");
    peer.oniceconnectionstatechange = _e => {
      console.log(`connection state changed to ${peer.iceConnectionState}`);
    };

    peer.onnegotiationneeded = async () => {
      console.log("Negotiation needed");

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      if (peer.localDescription !== null) {
        const msg: Message = {
          type: MsgType.SESSION_DESCRIPTION,
          payload: peer.localDescription
        };
        socket.send(JSON.stringify(msg));
      }
    };

    peer.onicecandidate = async event => {
      const candidate = event.candidate;

      // Candidate is null
      if (!candidate) {
        console.log("end of ice candidates");
        return;
      } else {
        console.log("new ice candidate");
      }

      const message: Message = {
        type: MsgType.ICE_CANDIDATE,
        payload: candidate
      };

      socket.send(JSON.stringify(message));
    };

    peer.ontrack = async event => {
      // Promise resolution point, MediaStream acquired
      resolve(event.streams[0]);
    };

    socket.onmessage = async (e) => {
      const message: Message = JSON.parse(e.data);

      console.log("received message");
      switch (message.type) {
        case MsgType.SESSION_DESCRIPTION:
          switch (peer.signalingState) {
            case "stable":
              console.log("received offer");
              const remoteDescription: RTCSessionDescription = message.payload;

              await peer.setRemoteDescription(remoteDescription);
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              const newMessage: Message = {
                type: MsgType.SESSION_DESCRIPTION,
                payload: answer
              };

              console.log("sending answer to peer");
              socket.send(JSON.stringify(newMessage));
              break;
            case "have-local-offer":
              console.log("received answer");
              break;
            default:
              console.log("Received session description while in an invalid state");
          }
          break;
        case MsgType.ICE_CANDIDATE:
          console.log("Received ice candidate");
          console.log(message);
          const iceCandidate: RTCIceCandidateInit = message.payload;
          await peer.addIceCandidate(iceCandidate);
          break;
        default:
          console.log("unsupported message '%i' type received from socket", message.type);
      }
    };
  });

  const track = await mediaStreamPromise;

  const disconnect = () => {
    if (!peer) return;
    console.log("closing peer connection");
    peer.close();
  };

  return [track, disconnect];
}
