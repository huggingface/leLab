import { useCallback, useEffect, useRef, useState, ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Peer = { id: string; openedAt: number; lastSeen: number };

const CHANNEL = "lelab-tabs-v1";
const HEARTBEAT_MS = 1000;
const PEER_TIMEOUT_MS = 3000;

const SingleTabGuard = ({ children }: { children: ReactNode }) => {
  const [isPrimary, setIsPrimary] = useState(true);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const myIdRef = useRef<string>("");
  const myOpenedAtRef = useRef<number>(0);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const recompute = useCallback(() => {
    const peers = peersRef.current;
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    for (const [id, peer] of peers) {
      if (peer.lastSeen < cutoff) peers.delete(id);
    }
    let winnerId = myIdRef.current;
    let winnerOpenedAt = myOpenedAtRef.current;
    for (const peer of peers.values()) {
      if (
        peer.openedAt < winnerOpenedAt ||
        (peer.openedAt === winnerOpenedAt && peer.id < winnerId)
      ) {
        winnerId = peer.id;
        winnerOpenedAt = peer.openedAt;
      }
    }
    setIsPrimary(winnerId === myIdRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }

    myIdRef.current = crypto.randomUUID();
    myOpenedAtRef.current = Date.now();

    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;

    const send = (type: string) => {
      channel.postMessage({
        type,
        id: myIdRef.current,
        openedAt: myOpenedAtRef.current,
      });
    };

    channel.onmessage = (e) => {
      const msg = e.data;
      if (!msg || msg.id === myIdRef.current) return;
      const peers = peersRef.current;

      if (msg.type === "HEARTBEAT") {
        peers.set(msg.id, {
          id: msg.id,
          openedAt: msg.openedAt,
          lastSeen: Date.now(),
        });
      } else if (msg.type === "RELEASE") {
        peers.delete(msg.id);
      } else if (msg.type === "TAKEOVER") {
        peers.set(msg.id, {
          id: msg.id,
          openedAt: msg.openedAt,
          lastSeen: Date.now(),
        });
        // Move ourselves behind the taker so the election flips.
        if (myOpenedAtRef.current <= msg.openedAt) {
          myOpenedAtRef.current = msg.openedAt + 1;
        }
      }
      recompute();
    };

    send("HEARTBEAT");
    const interval = setInterval(() => {
      send("HEARTBEAT");
      recompute();
    }, HEARTBEAT_MS);

    const onUnload = () => send("RELEASE");
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      clearInterval(interval);
      send("RELEASE");
      channel.close();
      channelRef.current = null;
    };
  }, [recompute]);

  const takeOver = useCallback(() => {
    myOpenedAtRef.current = 0;
    channelRef.current?.postMessage({
      type: "TAKEOVER",
      id: myIdRef.current,
      openedAt: 0,
    });
    recompute();
  }, [recompute]);

  // A non-primary tab renders only the blocker, not `children`. Anything the
  // app mounts as a descendant (a Radix modal that sets `pointer-events: none`
  // on `body`, the onboarding welcome dialog and `?` launcher) would otherwise
  // sit behind this overlay and, in the modal case, kill the "Use this tab"
  // button along with the rest of the page.
  return (
    <>
      {isPrimary && children}
      {!isPrimary && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-4 max-w-md space-y-4 rounded-lg border bg-background p-6 text-center shadow-lg">
            <h2 className="text-lg font-semibold">
              LeLab is already open in another tab
            </h2>
            <p className="text-sm text-muted-foreground">
              Only one tab can control the robot at a time. Switch back to the
              original tab, or take over here — the other tab will lock.
            </p>
            <Button onClick={takeOver}>Use this tab</Button>
          </div>
        </div>
      )}
    </>
  );
};

export default SingleTabGuard;
