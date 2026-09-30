'use client'
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Joystick2D } from '@/components/Joystick2D';
import { Joystick1D } from '@/components/Joystick1D';
import { Ros } from "@breq/roslib";
// TFViewer import commented out - uncomment if you want to restore TF visualization
// import TFViewer from '@/components/TFViewer';


// Move ROS setup outside component
const ros = new Ros({
  url: "wss://websocket.arnaconnect.stream",
});

// Dedicated base camera rosbridge connection (port 9091)
const rosBaseCam = new Ros({
  url: "wss://basewebsocket.arnaconnect.stream",
});

// Dedicated arm camera rosbridge connection (port 9092)
const rosArmCam = new Ros({
  url: "wss://armwebsocket.arnaconnect.stream",
});

// Add error handlers to prevent crashes when ROS is not connected
ros.on('error', (error) => {
  console.warn('ROS connection error:', error);
});

ros.on('close', () => {
  console.warn('ROS connection closed');
});

ros.on('connection', () => {
  console.log('ROS connected successfully');
});

rosBaseCam.on('error', (error) => {
  console.warn('ROS base cam connection error:', error);
});

rosBaseCam.on('close', () => {
  console.warn('ROS base cam connection closed');
});

rosBaseCam.on('connection', () => {
  console.log('ROS base cam connected successfully');
});

rosArmCam.on('error', (error) => {
  console.warn('ROS arm cam connection error:', error);
});

rosArmCam.on('close', () => {
  console.warn('ROS arm cam connection closed');
});

rosArmCam.on('connection', () => {
  console.log('ROS arm cam connected successfully');
});

const cartesianVelocityTopic = ros.Topic({
  name: "/my_gen3/in/cartesian_velocity_desired",
  messageType: "kortex_driver/TwistCommand",
  queue_size: 1,
});

const gripperService = ros.Service({
  name: "my_gen3/base/send_gripper_command",
  serviceType: "kortex_driver/SendGripperCommand",
});

// Base control topic - publishes to ARNA_TELEOP_MOV for base movement
const baseTeleopTopic = ros.Topic({
  name: "/ARNA_TELEOP_MOV",
  messageType: "std_msgs/Float32MultiArray",
  queue_size: 1,
});

const clickPointTopic = ros.Topic({
  name: "/pick_click_point",
  messageType: "geometry_msgs/Point",
  queue_size: 1,
});

const pickReadyTopic = ros.Topic({
  name: "/pick_ready",
  messageType: "std_msgs/Bool",
  queue_size: 1,
});

const runPickTopic = ros.Topic({
  name: "/run_pick",
  messageType: "std_msgs/Bool",
  queue_size: 1,
});

const pickRunningTopic = ros.Topic({
  name: "/pick_running",
  messageType: "std_msgs/Bool",
  queue_size: 1,
});

const baseFeedbackTopic = ros.Topic({
  name: "/my_gen3/base_feedback",
  messageType: "kortex_driver/BaseCyclic_Feedback",
  queue_size: 1,
});

const executeActionService = ros.Service({
  name: "/my_gen3/base/execute_action",
  serviceType: "kortex_driver/ExecuteAction",
});

// ── Layer 0: Network quality probe topics ─────────────────────────────────────
// The browser publishes pings, the relay echoes them back, and we measure RTT
// using performance.now() on the browser clock.  The computed RTT is published
// to /browser_rtt_ms so network_monitor_node can build its rolling statistics.
const networkProbePingTopic = ros.Topic({
  name: "/network_probe_ping",
  messageType: "std_msgs/String",
  queue_size: 10,
});

const networkProbePongTopic = ros.Topic({
  name: "/network_probe_pong",
  messageType: "std_msgs/String",
  queue_size: 10,
});

const browserRttTopic = ros.Topic({
  name: "/browser_rtt_ms",
  messageType: "std_msgs/Float64",
  queue_size: 10,
});

let _probeSeq = 0;
const _pendingProbes = new Map<number, number>(); // seq → send timestamp

function startNetworkProbeLoop() {
  // Subscribe to pongs before starting pings so we don't miss any.
  networkProbePongTopic.subscribe((msg: { data: string }) => {
    try {
      const payload = JSON.parse(msg.data) as { seq: number; t: number };
      const sendTime = _pendingProbes.get(payload.seq);
      if (sendTime === undefined) return;   // duplicate or timed-out probe
      _pendingProbes.delete(payload.seq);
      const rtt = performance.now() - sendTime;
      browserRttTopic.publish({ data: rtt });
    } catch {
      // malformed pong — ignore
    }
  });

  // Publish a ping every 100 ms.
  setInterval(() => {
    const seq = ++_probeSeq;
    const t   = performance.now();
    _pendingProbes.set(seq, t);
    networkProbePingTopic.publish({ data: JSON.stringify({ seq, t }) });

    // Treat probes older than 500 ms as lost and remove them so the Map
    // does not grow without bound when the connection is degraded.
    const cutoff = t - 500;
    _pendingProbes.forEach((sendTime, s) => {
      if (sendTime < cutoff) _pendingProbes.delete(s);
    });
  }, 100);
}

// Start the probe loop once the control WebSocket is connected.
ros.on('connection', () => {
  startNetworkProbeLoop();
});


let gripperCallback = (gripper: number) => {};
let setPickRunningCallback = (running: boolean) => {};
let gripperFeedbackInit = false;

enum Plane {
  XY = 'XY',
  YZ = 'YZ',
  XZ = 'XZ'
}

interface ControlState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  gripper: number;
  gripperFeedback: number;
  speed: number;
  selectedPlane: Plane;
  // Base control state
  baseTranslation: { x: number; y: number }; // x = strafe, y = forward/backward
  baseRotation: { x: number; y: number }; // x = rotation, y = forward/backward (alternative)
}

const PickButton = memo(() => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    pickReadyTopic.subscribe((message: { data: boolean }) => {
      setIsReady(message.data);
    });

    return () => {
      pickReadyTopic.unsubscribe();
    };
  }, []);

  const handleClick = useCallback(() => {
    setPickRunningCallback(true);  // immediately suppress velocity before ROS round-trip
    runPickTopic.publish({ data: true });
  }, []);

  return (
    <button
      onClick={handleClick}
      disabled={!isReady}
      className="btn btn-primary mt-4 w-48"
    >
      Run Pick
    </button>
  );
});

PickButton.displayName = 'PickButton';

// Memoized Camera Component - streams via WebSocket (rosbridge) using compressed topics
const CameraViewer = memo(({ topic, label, showPickButton = false, rosInstance, throttleRate = 33 }: { topic: string, label: string, showPickButton?: boolean, rosInstance?: Ros, throttleRate?: number }) => {
  const [imageSrc, setImageSrc] = useState<string>('');
  const imgRef = useRef<HTMLImageElement>(null);
  const connection = rosInstance ?? ros;

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    x *= e.currentTarget.naturalWidth / e.currentTarget.width;
    y *= e.currentTarget.naturalHeight / e.currentTarget.height;

    clickPointTopic.publish({
      x: x,
      y: y,
      z: 0
    });
  }, []);

  useEffect(() => {
    // Subscribe to the compressed version of the topic via WebSocket
    // Using CBOR compression for binary transport (no base64 overhead)
    const compressedTopic = connection.Topic({
      name: topic + '/compressed',
      messageType: 'sensor_msgs/CompressedImage',
      queue_size: 1,
      throttle_rate: throttleRate,
      compression: 'cbor',
    });

    let previousUrl: string | null = null;

    compressedTopic.subscribe((message: any) => {
      // With CBOR, message.data arrives as raw bytes (Uint8Array)
      // Use Blob URL instead of data URL for faster rendering
      const blob = new Blob([message.data], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      if (previousUrl) URL.revokeObjectURL(previousUrl);
      previousUrl = url;

      setImageSrc(url);
    });

    return () => {
      compressedTopic.unsubscribe();
      if (previousUrl) URL.revokeObjectURL(previousUrl);
    };
  }, [topic, connection, throttleRate]);

  return (
    <div className="flex flex-col items-center">
      <div className="max-w-2xl flex flex-col w-full">
        <h3 className="text-base-content my-2 text-center font-semibold">{label}</h3>
        {imageSrc ? (
          <img
            ref={imgRef}
            onClick={handleImageClick}
            src={imageSrc}
            alt={label}
            className="rounded-lg"
          />
        ) : (
          <div className="rounded-lg bg-base-300 flex items-center justify-center aspect-video">
            <span className="text-base-content opacity-50">Waiting for camera...</span>
          </div>
        )}
      </div>
      {showPickButton && <PickButton />}
    </div>
  );
});

CameraViewer.displayName = 'CameraViewer';

// Memoized Plane Button Component
const PlaneButton = memo(({ plane, selectedPlane, onSelect }: {
  plane: Plane;
  selectedPlane: Plane;
  onSelect: (plane: Plane) => void;
}) => (
  <button
    onClick={() => onSelect(plane)}
    className={`btn btn-sm ${selectedPlane === plane
      ? 'btn-primary text-primary-content'
      : 'btn-ghost text-base-content'}`}
  >
    {plane} Plane
  </button>
));

PlaneButton.displayName = 'PlaneButton';

const HomeButton = memo(() => {
  const [homing, setHoming] = useState(false);
  const homingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (homing) return;

    // Suppress velocity commands via the pick_running gate so the MPC-CBF node
    // stops publishing to cartesian_velocity.  Any SendTwistCommand — even all
    // zeros — will immediately abort an active ExecuteAction trajectory on the
    // Kinova Gen3, so we must silence the 10 Hz publisher before calling the
    // service.
    setHoming(true);
    setPickRunningCallback(true);
    pickRunningTopic.publish({ data: true });

    executeActionService.callService({
      input: {
        "handle": {
          "identifier": 2,
          "action_type": 7,   // REACH_JOINT_ANGLES = 7
          "permission": 1
        },
        "name": "Home",
        "application_data": "",
        "oneof_action_parameters": {
          "send_twist_command": [],
          "send_wrench_command": [],
          "send_joint_speeds": [],
          "reach_pose": [],
          "reach_joint_angles": [
            {
              "joint_angles": {
                "joint_angles": [
                  { "joint_identifier": 0, "value": 0.0   },
                  { "joint_identifier": 1, "value": 15.0  },
                  { "joint_identifier": 2, "value": 180.0 },
                  { "joint_identifier": 3, "value": 230.0 },
                  { "joint_identifier": 4, "value": 0.0   },
                  { "joint_identifier": 5, "value": 55.0  },
                  { "joint_identifier": 6, "value": 90.0  }
                ]
              },
              "constraint": { "type": 0, "value": 0.0 }
            }
          ],
          "toggle_admittance_mode": [],
          "snapshot": [],
          "switch_control_mapping": [],
          "navigate_joints": [],
          "navigate_mappings": [],
          "change_twist": [],
          "change_joint_speeds": [],
          "change_wrench": [],
          "apply_emergency_stop": [],
          "clear_faults": [],
          "delay": [],
          "execute_action": [],
          "send_gripper_command": [],
          "send_gpio_command": [],
          "stop_action": [],
          "play_pre_computed_trajectory": [],
          "execute_sequence": [],
          "execute_waypoint_list": []
        }
      }
    }).catch((err: unknown) => {
      console.error('[HomeButton] execute_action service call failed:', err);
      setHoming(false);
      setPickRunningCallback(false);
      pickRunningTopic.publish({ data: false });
    });

    // Re-enable velocity control after the trajectory has had time to complete.
    // Gen3 home trajectory takes ~8 s from any reachable pose; 12 s is safe.
    homingTimerRef.current = setTimeout(() => {
      setHoming(false);
      setPickRunningCallback(false);
      pickRunningTopic.publish({ data: false });
      homingTimerRef.current = null;
    }, 12000);
  }, [homing]);

  return (
    <button
      onClick={handleClick}
      disabled={homing}
      className="btn btn-primary mt-4 w-48"
    >
      {homing ? 'Homing…' : 'Home'}
    </button>
  );
});

HomeButton.displayName = 'HomeButton';

// TF Viewer - COMMENTED OUT TO MAKE ROOM FOR BASE CONTROL
// Uncomment this section and add <MemoizedTFViewer /> back to the UI to restore TF visualization
/*
const MemoizedTFViewer = memo(() => {
  return (
    <TFViewer
      ros={ros}
      tfTopics={['/tf', '/tf_static']}
      fixedFrame='base_link'
      originAxisSize={0.1}
      frameAxisSize={0.02}
      showFrameNames={false}
      connectionColor="#f59e0b"
    />
  );
});

MemoizedTFViewer.displayName = 'TFViewer';
*/

const GripperControl = memo(({ controlState, handleGripperChange }: { controlState: ControlState, handleGripperChange: (value: number) => void }) => {
  return (
    <div className="w-full mx-auto">
      <h3 className="card-title text-base-content mb-2">Gripper Control</h3>
      <div className="w-full flex flex-col items-center justify-center">
        <div className="w-full flex flex-row items-center justify-center">
          <span className="text-base-content mr-4">Open</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={controlState.gripper}
            onChange={(e) => handleGripperChange(parseFloat(e.target.value))}
            className="range range-primary"
          />
          <span className="text-base-content ml-4">Closed</span>
        </div>
        <div className="flex gap-4 text-base-content mt-4">
          <span>Command: {(controlState.gripper * 100).toFixed(0)}%</span>
          <span>Actual: {(controlState.gripperFeedback * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  )
});

GripperControl.displayName = 'GripperControl';

// Safety mode badge — subscribes to /safety_mode published by network_watchdog_node
const SAFETY_MODE_STYLES: Record<string, { bg: string; dot: string; text: string }> = {
  NOMINAL:  { bg: 'bg-green-100 dark:bg-green-900',   dot: 'bg-green-500',  text: 'text-green-800 dark:text-green-200'  },
  DEGRADED: { bg: 'bg-yellow-100 dark:bg-yellow-900', dot: 'bg-yellow-400', text: 'text-yellow-800 dark:text-yellow-200' },
  POOR:     { bg: 'bg-orange-100 dark:bg-orange-900', dot: 'bg-orange-500', text: 'text-orange-800 dark:text-orange-200' },
  FAILED:   { bg: 'bg-red-100 dark:bg-red-900',       dot: 'bg-red-600',    text: 'text-red-800 dark:text-red-200'       },
};

const safetyModeTopic = ros.Topic({
  name: '/safety_mode',
  messageType: 'std_msgs/String',
  queue_size: 1,
});

const SafetyBadge = memo(() => {
  const [mode, setMode] = useState<string>('—');

  useEffect(() => {
    safetyModeTopic.subscribe((msg: { data: string }) => {
      setMode(msg.data);
    });
    return () => { safetyModeTopic.unsubscribe(); };
  }, []);

  const style = SAFETY_MODE_STYLES[mode] ?? {
    bg: 'bg-gray-100 dark:bg-gray-800', dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-300'
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
      {mode}
    </div>
  );
});

SafetyBadge.displayName = 'SafetyBadge';

// Memoized Theme Toggle Component
const ThemeToggle = memo(() => (
  <label className="swap swap-rotate text-base-content">
    <input type="checkbox" className="theme-controller" value="corporate" />
    <svg
      className="swap-off h-10 w-10 fill-current"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24">
      <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z" />
    </svg>
    <svg
      className="swap-on h-10 w-10 fill-current"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24">
      <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z" />
    </svg>
  </label>
));

ThemeToggle.displayName = 'ThemeToggle';

// Main Component
export default function RobotControl() {
  const [isPickRunning, setIsPickRunning] = useState(false);

  setPickRunningCallback = useCallback((running: boolean) => {
    setIsPickRunning(running);
  }, []);

  const [controlState, setControlState] = useState<ControlState>({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    gripper: 0,
    gripperFeedback: 0,
    speed: 0.3,
    selectedPlane: Plane.XY,
    // Base control initial state
    baseTranslation: { x: 0, y: 0 },
    baseRotation: { x: 0, y: 0 }
  });

  // Memoized handlers
  const handlePositionChange = useCallback((x: number, y: number) => {
    setControlState(prev => ({
      ...prev,
      position: { ...prev.position, x, y }
    }));
  }, []);

  const handleNormalAxisChange = useCallback((value: number) => {
    setControlState(prev => ({
      ...prev,
      position: { ...prev.position, z: value }
    }));
  }, []);

  const handleRotationChange = useCallback((axis: 'x' | 'y' | 'z', value: number) => {
    setControlState(prev => ({
      ...prev,
      rotation: { ...prev.rotation, [axis]: value }
    }));
  }, []);

  const handlePlaneChange = useCallback((plane: Plane) => {
    setControlState(prev => ({ ...prev, selectedPlane: plane }));
  }, []);

  const handleGripperChange = useCallback((value: number) => {
    setControlState(prev => ({ ...prev, gripper: value }));
  }, []);

  const handleSpeedChange = useCallback((value: number) => {
    setControlState(prev => ({ ...prev, speed: value }));
  }, []);

  // Base control handlers
  const handleBaseTranslationChange = useCallback((x: number, y: number) => {
    setControlState(prev => ({
      ...prev,
      baseTranslation: { x, y }
    }));
  }, []);

  const handleBaseRotationChange = useCallback((x: number, y: number) => {
    setControlState(prev => ({
      ...prev,
      baseRotation: { x, y }
    }));
  }, []);

  useEffect(() => {
    pickRunningTopic.subscribe((message: { data: boolean }) => {
      setIsPickRunning(message.data);
    });
    return () => {
      pickRunningTopic.unsubscribe();
    };
  }, []);

  useEffect(() =>
  {
    // Publish at a fixed 10 Hz regardless of whether anything changed.
    // This ensures the arm receives continuous zero commands after joystick
    // release (one reactive publish was insufficient because the MPC-CBF LPF
    // would freeze at 0.73×last_value and never decay to zero).
    const interval = setInterval(() => {
      if (isPickRunning) {
        cartesianVelocityTopic.publish({
          reference_frame: 0,
          twist: { linear_x: 0, linear_y: 0, linear_z: 0, angular_x: 0, angular_y: 0, angular_z: 0 },
          duration: 0
        });
        return;
      }

      const twist = {
        linear_x: 0,
        linear_y: 0,
        linear_z: 0,
        angular_x: controlState.rotation.x,
        angular_y: controlState.rotation.z,
        angular_z: controlState.rotation.y
      };

      switch (controlState.selectedPlane) {
        case Plane.XY:
          twist.linear_x = controlState.position.y;
          twist.linear_y = -controlState.position.x;
          twist.linear_z = controlState.position.z;
          break;
        case Plane.YZ:
          twist.linear_y = -controlState.position.x;
          twist.linear_z = controlState.position.y;
          twist.linear_x = controlState.position.z;
          break;
        case Plane.XZ:
          twist.linear_x = controlState.position.x;
          twist.linear_z = controlState.position.y;
          twist.linear_y = controlState.position.z;
          break;
      }

      Object.keys(twist).forEach(key => {
        twist[key as keyof typeof twist] *= controlState.speed * 0.4;
      });

      cartesianVelocityTopic.publish({
        reference_frame: 0,
        twist: twist,
        duration: 0
      });
    }, 100); // 10 Hz

    return () => clearInterval(interval);

  }, [controlState.position, controlState.rotation, controlState.selectedPlane, controlState.speed, isPickRunning]);

  useEffect(() => {
    gripperService.callService({
      input: {
        mode: 3,
        gripper: {
          finger: [{
            finger_identifier: 0,
            value: controlState.gripper
          }]
        },
        duration: 0
      }
    });
  }, [controlState.gripper]);

  // Base control effect - publishes to ARNA_TELEOP_MOV
  // Array format: [base_y, base_x, base_rotation, arm_x, arm_y, arm_z, arm_roll, arm_pitch, arm_yaw, gripper]
  // For base-only control, we send zeros for arm values (indices 3-9)
  // Base control effect - continuously publishes to ARNA_TELEOP_MOV at 10Hz
  useEffect(() => {
    const interval = setInterval(() => {
      const forwardBackward = controlState.baseTranslation.y * controlState.speed;
      const strafe = -controlState.baseTranslation.x * controlState.speed;
      const rotation = -controlState.baseRotation.x * controlState.speed;

      baseTeleopTopic.publish({
        data: [
          forwardBackward,
          strafe,
          rotation,
          0, 0, 0, 0, 0, 0, 0
        ]
      });
    }, 100); // 10Hz

    return () => clearInterval(interval);
  }, [controlState.baseTranslation, controlState.baseRotation, controlState.speed]);

  const getNormalAxisLabel = useCallback(() => {
    switch (controlState.selectedPlane) {
      case Plane.XY: return 'Z';
      case Plane.YZ: return 'X';
      case Plane.XZ: return 'Y';
    }
  }, [controlState.selectedPlane]);

  const getPlaneLabel = useCallback((plane: Plane) => {
    switch (plane) {
      case Plane.XY: return 'XY';
      case Plane.YZ: return 'YZ';
      case Plane.XZ: return 'XZ';
    }
  }, []);

  gripperCallback = useCallback((gripperPos: number) =>
  {
    if (controlState.gripperFeedback != gripperPos) {
      if (!gripperFeedbackInit) {
        setControlState(prev => ({ ...prev, gripperFeedback: gripperPos, gripper: gripperPos }));
        gripperFeedbackInit = true;
        return;
      }

      setControlState(prev => ({ ...prev, gripperFeedback: gripperPos }));
    }
  }, [controlState]);

  // Subscribe to gripper feedback
  useEffect(() => {
    baseFeedbackTopic.subscribe((message: any) => {
      const gripperPos = (message.interconnect?.oneof_tool_feedback?.gripper_feedback?.[0]?.motor?.[0]?.position ?? 0) / 100.0;
      gripperCallback(gripperPos);
    });

    return () => {
      baseFeedbackTopic.unsubscribe();
    };
  }, []);

  return (
    <div onContextMenuCapture={(e) => e.preventDefault()} className="min-h-screen bg-base-200 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <div className="flex justify-between items-center">
              <h1 className="card-title text-2xl mb-2 text-base-content">ARNA Control Interface</h1>
              <div className="flex items-center gap-3">
                <SafetyBadge />
                <ThemeToggle />
              </div>
            </div>

            {/* Camera View Section */}
            <div className="mt-8 cam-view bg-base-100">
              <h2 className="card-title text-base-content my-2 text-center">Camera View</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CameraViewer topic="/pick_place_cam" label="Arm Camera" showPickButton={true} rosInstance={rosArmCam} throttleRate={33} />
                <CameraViewer topic="/base_cam/rgb/image_raw" label="Base Camera" rosInstance={rosBaseCam} throttleRate={80} />
              </div>
            </div>

            <div className="grid grid-flow-dense gap-5 grid-cols-1 md:grid-cols-2">


              {/* Speed Control */}
              <div className="card bg-base-200 row-span-1">
                <div className="card-body flex items-center">
                  <div className="max-w-2xl flex flex-col items-center w-full">
                    <h2 className="card-title text-base-content mb-2">Speed Control</h2>
                    <div className="px-4 w-full">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={controlState.speed}
                        onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                        className="range range-accent"
                      />
                      <div className="text-center mt-2 text-sm opacity-80 text-base-content">
                        Speed: {(controlState.speed * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* TF VIEWER - COMMENTED OUT, REPLACED WITH BASE CONTROL */}
              {/* Uncomment this section to restore TF Tree Visualization
              <div className="card bg-base-200 row-span-2">
                <div className="card-body">
                  <h2 className="card-title text-base-content">TF Tree Visualization</h2>
                  <MemoizedTFViewer />
                </div>
              </div>
              */}

              {/* BASE CONTROL - Two joysticks for mobile base control */}
              <div className="card bg-base-200 row-span-2">
                <div className="card-body">
                  <h2 className="card-title text-base-content mb-4">Base Control</h2>
                  
                  <div className="flex flex-row gap-8 h-full justify-center items-center">
                    {/* Translation Joystick: X = strafe (left/right), Y = forward/backward */}
                    <div className="flex flex-col items-center">
                      <Joystick2D
                        size={180}
                        baseColor="oklch(var(--pc))"
                        stickColor="oklch(var(--p))"
                        onChange={handleBaseTranslationChange}
                        onEnd={() => handleBaseTranslationChange(0, 0)}
                        label="XY"
                      />
                    </div>

                    {/* Rotation Joystick: X = rotation, Y = alternative forward/backward (currently unused) */}
                    <div className="flex flex-col items-center">
                      <Joystick2D
                        size={180}
                        baseColor="oklch(var(--pc))"
                        stickColor="oklch(var(--p))"
                        onChange={handleBaseRotationChange}
                        onEnd={() => handleBaseRotationChange(0, 0)}
                        label="θ Rotation"
                      />
                    </div>
                  </div>
                  
                  {/* <div className="text-xs text-base-content opacity-60 mt-4 text-center">
                    Publishes to: /ARNA_TELEOP_MOV
                  </div> */}
                </div>
              </div>

              {/* Arm Position Controls */}
              <div className="card bg-base-200 row-span-2">
                <div className="card-body">
                  <h2 className="card-title text-base-content mb-2">Arm Position Control</h2>
                  
                  <div className="flex w-full justify-center gap-4 mb-6 flex-wrap">
                    {Object.values(Plane).map(plane => (
                      <PlaneButton
                        key={plane}
                        plane={plane}
                        selectedPlane={controlState.selectedPlane}
                        onSelect={handlePlaneChange}
                      />
                    ))}
                  </div>

                  <div className="flex h-full gap-8">
                    <div className="w-full h-full mx-auto mb-8">
                      <div className="w-full h-full flex items-center justify-center">
                        <Joystick2D
                          size={200}
                          baseColor="oklch(var(--pc))"
                          stickColor="oklch(var(--p))"
                          onChange={handlePositionChange}
                          onEnd={() => handlePositionChange(0, 0)}
                          label={getPlaneLabel(controlState.selectedPlane) + " Plane"}
                        />
                      </div>
                    </div>

                    <div className="w-full h-full mx-auto">
                      <div className="w-full h-full flex flex-col items-center justify-center">
                        <Joystick1D
                          size={200}
                          baseColor="oklch(var(--pc))"
                          stickColor="oklch(var(--p))"
                          vertical={true}
                          onChange={handleNormalAxisChange}
                          onEnd={() => handleNormalAxisChange(0)}
                          label={getNormalAxisLabel() + ' Axis'}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full justify-center gap-4 mb-6 flex-wrap">
                    <HomeButton />
                  </div>

                  {/* Gripper Control */}
                  <GripperControl
                    controlState={controlState}
                    handleGripperChange={handleGripperChange}
                  />
                </div>
              </div>

              {/* Arm Rotation Controls */}

              <div className="card bg-base-200 row-span-1">
                <div className="card-body">
                  <h2 className="card-title text-base-content mb-2">Arm Rotation Control</h2>
                  <div className="flex justify-between gap-8 max-w-[300px] mx-auto">
                    {/* Z Rotation */}
                    <div className="flex-1">
                      <Joystick1D
                        size={200}
                        baseColor="oklch(var(--sc))"
                        stickColor="oklch(var(--s))"
                        vertical={true}
                        onChange={(value) => handleRotationChange('y', value)}
                        onEnd={() => handleRotationChange('y', 0)}
                        label='Roll (Y)'
                      />
                    </div>

                    {/* X Rotation */}
                    <div className="flex-1">
                      <Joystick1D
                        size={200}
                        baseColor="oklch(var(--sc))"
                        stickColor="oklch(var(--s))"
                        vertical={true}
                        onChange={(value) => handleRotationChange('x', value)}
                        onEnd={() => handleRotationChange('x', 0)}
                        label='Pitch (X)'
                      />
                    </div>

                    {/* Y Rotation */}
                    <div className="flex-1">
                      <Joystick1D
                        size={200}
                        baseColor="oklch(var(--sc))"
                        stickColor="oklch(var(--s))"
                        vertical={true}
                        onChange={(value) => handleRotationChange('z', value)}
                        onEnd={() => handleRotationChange('z', 0)}
                        label='Yaw (Z)'
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}