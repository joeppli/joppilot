import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { TelemetryPayload } from '@joppilot/contract';

function App() {
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('Connecting to Gateway...');
  
  // Operator Session State
  const [operatorId] = useState<string>(`OP-${Math.floor(Math.random() * 1000)}`);
  const [token, setToken] = useState<string | null>(null);
  
  const vehicleId = 'VEH-001';
  const heartbeatIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    // AWS Migration Phase 3: Connect to NestJS via Socket.IO instead of Mosquitto WebSocket
    // This hides AWS IoT Core credentials and architecture from the client.
    const socket: Socket = io('http://localhost:4001');

    socket.on('connect', () => {
      setConnectionStatus('Connected to Backend Gateway (Live)');
    });

    socket.on(`telemetry/${vehicleId}`, (payload: TelemetryPayload) => {
      setTelemetry(payload);
    });

    socket.on('disconnect', () => {
      setConnectionStatus('Disconnected from Gateway');
    });

    socket.on('connect_error', (err) => {
      setConnectionStatus(`Connection Error: ${err.message}`);
    });

    return () => {
      socket.disconnect();
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  }, [vehicleId]);

  // Phase 2: Heartbeat Monitor (Deadman Switch)
  useEffect(() => {
    if (token) {
      heartbeatIntervalRef.current = window.setInterval(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:4000/api/command/${vehicleId}/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operatorId, token })
          });
          const data = await res.json();
          if (data.status === 'deadman_triggered') {
            setToken(null);
            alert("HEARTBEAT FAILED! You lost control. Deadman Triggered.");
            clearInterval(heartbeatIntervalRef.current!);
          }
        } catch (e) {
          console.error("Heartbeat fetch failed");
        }
      }, 2000);
    } else {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    }
    return () => {
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  }, [token, operatorId, vehicleId]);

  const handleTakeControl = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:4000/api/command/${vehicleId}/take-control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId })
      });
      if (!response.ok) {
        alert("Failed to take control! Vehicle might be locked by another operator.");
        return;
      }
      const data = await response.json();
      setToken(data.token);
    } catch (err) {
      alert(`Network Error: ${err}`);
    }
  };

  // Dedicated topic endpoints (E-STOP) and the generic command endpoint.
  const postCommand = async (path: string, body: object) => {
    if (!token) {
      alert("You MUST Take Control first!");
      return;
    }
    try {
      const response = await fetch(`http://127.0.0.1:4000/api/command/${vehicleId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId, token, ...body })
      });
      if (response.status === 401) {
        alert("Unauthorized! Fencing token is invalid.");
        setToken(null);
        return;
      }
      const data = await response.json();
      if (!response.ok) {
        // 1st gate rejection (e.g. MODE_MISMATCH on a public route)
        console.warn(`Rejected ${path}:`, data);
        alert(`Command rejected: ${data?.reason ?? data?.message ?? response.status}`);
        return;
      }
      console.log(`Dispatched ${path}:`, data);
    } catch (err) {
      alert(`Failed to dispatch ${path}: ${err}`);
    }
  };

  // E-STOP has its own highest-priority endpoint/topic.
  const dispatchEStop = () => postCommand('estop', {});
  // Everything else goes through the generic command endpoint with a typed payload.
  const dispatchPayload = (payload: object) => postCommand('command', { payload });

  // ERS-04: Global Keyboard Shortcut for E-STOP
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault(); // Prevent page scrolling
        dispatchEStop();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [token, operatorId, vehicleId]);

  return (
    <div style={{ padding: '40px', fontFamily: 'sans-serif', maxWidth: '600px', margin: '0 auto' }}>
      <h1 tabIndex={0}>Joppilot Console</h1>
      
      <div style={{ padding: '15px', borderRadius: '8px', backgroundColor: '#1e1e1e', marginBottom: '20px' }} tabIndex={0}>
        <h3>Vehicle: {vehicleId}</h3>
        <p>Telemetry Status: <strong style={{ color: connectionStatus.includes('Live') ? '#4caf50' : '#f44336' }}>{connectionStatus}</strong></p>
        
        <div style={{ padding: '10px', backgroundColor: '#333', borderRadius: '4px', marginBottom: '15px' }}>
          <h4>Operator: {operatorId}</h4>
          <p>Control Status: {token ? <span style={{ color: '#4caf50' }}>ACTIVE (Lock Acquired)</span> : <span style={{ color: '#f44336' }}>OBSERVING ONLY</span>}</p>
          {!token && (
            <button 
              onClick={handleTakeControl} 
              aria-label="Take Control of the Vehicle"
              style={{ padding: '10px 20px', cursor: 'pointer', background: '#2196f3', color: 'white', border: 'none', borderRadius: '4px' }}>
              Take Control
            </button>
          )}
        </div>

        {telemetry ? (
          <div style={{ marginTop: '20px' }}>
            <p><strong>Speed:</strong> {telemetry.speedKmh.toFixed(1)} km/h</p>
            <p><strong>Battery:</strong> {telemetry.battery?.percent?.toFixed(1)} %</p>
            <p><strong>Mode:</strong> {telemetry.mode}</p>
            <p><strong>State:</strong> <span style={{ color: telemetry.vehicleState === 'SAFE_STOPPED' ? '#f44336' : '#4caf50' }}>{telemetry.vehicleState}</span></p>
            <p><strong>Zone:</strong> {telemetry.currentZone ?? 'unknown'}</p>
            <p><strong>Location:</strong> {telemetry.location.lat.toFixed(5)}, {telemetry.location.lng.toFixed(5)}</p>
          </div>
        ) : (
          <p>Waiting for telemetry...</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={() => dispatchPayload({ action: 'STEER', angle: -1.5 })}
          aria-label="Send Steer Command in Mode 2"
          style={{ flex: 1, padding: '20px', backgroundColor: '#ff9800', color: 'white', fontSize: '18px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
        >
          STEER (Mode 2)
        </button>

        <button
          onClick={() => dispatchEStop()}
          aria-label="Trigger Emergency Stop. Keyboard shortcut: Spacebar"
          style={{ flex: 1, padding: '20px', backgroundColor: '#f44336', color: 'white', fontSize: '18px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
        >
          E-STOP (Mode 1)
        </button>

        <button
          onClick={() => postCommand('clear-safe-stop', {})}
          aria-label="Release a latched safe-stop (authorized action)"
          style={{ flex: 1, padding: '20px', backgroundColor: '#607d8b', color: 'white', fontSize: '18px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
        >
          CLEAR SAFE-STOP
        </button>
      </div>
    </div>
  );
}

export default App;
