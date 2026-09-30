import React, { useEffect, useRef, useCallback } from 'react';
import { Ros, Topic } from '@breq/roslib';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Transform {
  header: {
    frame_id: string;
  };
  child_frame_id: string;
  transform: {
    translation: {
      x: number;
      y: number;
      z: number;
    };
    rotation: {
      x: number;
      y: number;
      z: number;
      w: number;
    };
  };
}

interface TFMessage {
  transforms: Transform[];
}

interface FrameData {
  group: THREE.Group;
  parentFrame: string;
  localTransform: THREE.Matrix4;
  connectionLine?: THREE.Line;
}

class TransformHelper {
  private frames: Map<string, FrameData>;
  private fixedFrame: string;
  private transformCache: Map<string, THREE.Matrix4>;

  constructor(frames: Map<string, FrameData>, fixedFrame: string) {
    this.frames = frames;
    this.fixedFrame = fixedFrame;
    this.transformCache = new Map();
  }

  clearCache(): void {
    this.transformCache.clear();
  }

  getWorldTransform(frame: string): THREE.Matrix4 | null {
    if (frame === this.fixedFrame) {
      return new THREE.Matrix4();
    }

    const cacheKey = `${frame}_world`;
    if (this.transformCache.has(cacheKey)) {
      return this.transformCache.get(cacheKey)!.clone();
    }

    const frameData = this.frames.get(frame);
    if (!frameData) return null;

    const parentTransform = this.getWorldTransform(frameData.parentFrame);
    if (!parentTransform) return null;

    const worldTransform = parentTransform.multiply(frameData.localTransform.clone());
    this.transformCache.set(cacheKey, worldTransform.clone());
    
    return worldTransform;
  }
}

interface TFViewerProps {
  ros: Ros;
  className?: string;
  height?: string;
  tfTopics: string[];  // Changed to array of topics
  fixedFrame?: string;
  backgroundColor?: string;
  gridColor?: string;
  textColor?: string;
  axisColors?: {
    x: string;
    y: string;
    z: string;
  };
  connectionColor?: string;
  frameAxisSize?: number;
  originAxisSize?: number;
  showFrameNames?: boolean;
}

const TFViewer: React.FC<TFViewerProps> = ({ 
  ros, 
  className = '',
  height = 'h-96',
  tfTopics = ['/tf'],  // Default to single topic for backward compatibility
  fixedFrame = 'world',
  backgroundColor = '#1a1a1a',
  gridColor = '#404040',
  textColor = '#ffffff',
  axisColors = {
    x: '#ff7b72',
    y: '#7ee787',
    z: '#79c0ff'
  },
  connectionColor = '#666666',
  frameAxisSize = 0.2,
  originAxisSize = 1.0,
  showFrameNames = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameDataRef = useRef<Map<string, FrameData>>(new Map());
  const requestRef = useRef<number>();
  const transformHelperRef = useRef<TransformHelper>();
  const subscribersRef = useRef<Topic[]>([]);

  // Initialize transform helper
  useEffect(() => {
    transformHelperRef.current = new TransformHelper(frameDataRef.current, fixedFrame);
  }, [fixedFrame]);

  const createFrameVisual = useCallback((frameName: string): THREE.Group => {
    const group = new THREE.Group();
    
    // Add axes
    const axes = new THREE.Group();
    const createAxisLine = (direction: THREE.Vector3, color: string) => {
      const material = new THREE.LineBasicMaterial({ color });
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        direction.multiplyScalar(frameAxisSize)
      ]);
      return new THREE.Line(geometry, material);
    };
    
    axes.add(createAxisLine(new THREE.Vector3(1, 0, 0), axisColors.x));
    axes.add(createAxisLine(new THREE.Vector3(0, 1, 0), axisColors.y));
    axes.add(createAxisLine(new THREE.Vector3(0, 0, 1), axisColors.z));
    group.add(axes);
    
    // Add label if enabled
    if (showFrameNames) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = 256;
        canvas.height = 64;
        ctx.fillStyle = textColor;
        ctx.font = '24px Arial';
        ctx.fillText(frameName, 4, 24);
        
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
        sprite.position.set(0, 0, 0.15);
        sprite.scale.set(0.5, 0.125, 1);
        group.add(sprite);
      }
    }
    
    sceneRef.current?.add(group);
    return group;
  }, [axisColors, frameAxisSize, showFrameNames, textColor]);

  const handleTransformMessage = useCallback((message: TFMessage) => {
    message.transforms.forEach(transform => {
      const { header: { frame_id: parentFrame }, child_frame_id: childFrame, transform: tf } = transform;
      
      if (!frameDataRef.current.has(childFrame)) {
        frameDataRef.current.set(childFrame, {
          group: createFrameVisual(childFrame),
          parentFrame,
          localTransform: new THREE.Matrix4()
        });
      }

      const frameData = frameDataRef.current.get(childFrame);
      if (frameData) {
        frameData.parentFrame = parentFrame;
        frameData.localTransform.compose(
          new THREE.Vector3(tf.translation.x, tf.translation.y, tf.translation.z),
          new THREE.Quaternion(tf.rotation.x, tf.rotation.y, tf.rotation.z, tf.rotation.w),
          new THREE.Vector3(1, 1, 1)
        );
      }
    });
  }, [createFrameVisual]);

  // Scene setup effect
  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(2, -2, 2);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Add grid
    const gridHelper = new THREE.GridHelper(10, 10, gridColor, gridColor);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Add origin axes
    if (originAxisSize > 0) {
      const axesHelper = new THREE.Group();
      const createOriginAxisLine = (direction: THREE.Vector3, color: string) => {
        const material = new THREE.LineBasicMaterial({ color });
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          direction.multiplyScalar(originAxisSize)
        ]);
        return new THREE.Line(geometry, material);
      };
      
      axesHelper.add(createOriginAxisLine(new THREE.Vector3(1, 0, 0), axisColors.x));
      axesHelper.add(createOriginAxisLine(new THREE.Vector3(0, 1, 0), axisColors.y));
      axesHelper.add(createOriginAxisLine(new THREE.Vector3(0, 0, 1), axisColors.z));
      
      scene.add(axesHelper);
    }

    // Subscribe to all TF topics
    subscribersRef.current = tfTopics.map(topic => {
      const subscriber = ros.Topic({
        name: topic,
        messageType: 'tf2_msgs/TFMessage'
      });
      subscriber.subscribe(handleTransformMessage);
      return subscriber;
    });

    const updateFrameVisualization = () => {
      if (!transformHelperRef.current) return;

      transformHelperRef.current.clearCache();
      
      // Update frame positions
      frameDataRef.current.forEach((frameData, frameId) => {
        const worldTransform = transformHelperRef.current!.getWorldTransform(frameId);
        if (worldTransform) {
          const position = new THREE.Vector3();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          worldTransform.decompose(position, quaternion, scale);
          
          frameData.group.position.copy(position);
          frameData.group.quaternion.copy(quaternion);
        }
      });

      // Update connection lines
      frameDataRef.current.forEach((frameData) => {
        const parentFrame = frameData.parentFrame;
        if (parentFrame && frameDataRef.current.has(parentFrame)) {
          const parentPos = frameDataRef.current.get(parentFrame)!.group.position;
          const childPos = frameData.group.position;

          if (!frameData.connectionLine) {
            const material = new THREE.LineBasicMaterial({ 
              color: connectionColor,
              transparent: true,
              opacity: 0.6
            });
            const geometry = new THREE.BufferGeometry();
            const line = new THREE.Line(geometry, material);
            scene.add(line);
            frameData.connectionLine = line;
          }

          const positions = new Float32Array([
            parentPos.x, parentPos.y, parentPos.z,
            childPos.x, childPos.y, childPos.z
          ]);
          frameData.connectionLine.geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(positions, 3)
          );
        }
      });
    };

    // Animation loop
    const animate = () => {
      requestRef.current = requestAnimationFrame(animate);
      controlsRef.current?.update();
      updateFrameVisualization();
      rendererRef.current?.render(scene, camera);
    };
    animate();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      
      const { clientWidth, clientHeight } = containerRef.current;
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(clientWidth, clientHeight);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      subscribersRef.current.forEach(subscriber => subscriber.unsubscribe());
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      
      if (rendererRef.current) {
        containerRef.current?.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }

      // Dispose of all THREE.js resources
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach(m => m.dispose());
          } else {
            object.material.dispose();
          }
        }
      });

      frameDataRef.current.forEach(frameData => {
        if (frameData.connectionLine) {
          frameData.connectionLine.geometry.dispose();
          (frameData.connectionLine.material as THREE.Material).dispose();
        }
        frameData.group.traverse((object) => {
          if (object instanceof THREE.Sprite) {
            object.material.map?.dispose();
            object.material.dispose();
          }
        });
      });
    };
  }, [ros, tfTopics, fixedFrame, backgroundColor, gridColor, axisColors, 
      connectionColor, originAxisSize, handleTransformMessage]);

  return (
    <div className={`card bg-base-200 ${className}`}>
      <div className="card-body">
        <div 
          ref={containerRef} 
          className={`w-full ${height} rounded-lg overflow-hidden`}
          style={{ touchAction: 'none' }}
        />
      </div>
    </div>
  );
};

export default TFViewer;