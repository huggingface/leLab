
import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

const RobotArm = () => {
  return (
    <Canvas>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <group>
        {/* Base */}
        <mesh position={[0, -0.25, 0]}>
          <cylinderGeometry args={[1, 1, 0.5]} />
          <meshPhongMaterial color="#333333" />
        </mesh>
        
        {/* First joint */}
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry args={[0.3, 1.5, 0.3]} />
          <meshPhongMaterial color="#ff6b35" />
        </mesh>
        
        {/* Second segment */}
        <mesh position={[0.9, 1.2, 0]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[1.8, 0.25, 0.25]} />
          <meshPhongMaterial color="#ffdd44" />
        </mesh>
        
        {/* Third segment */}
        <mesh position={[1.8, 1.7, 0]} rotation={[0, 0, -0.5]}>
          <boxGeometry args={[1.2, 0.2, 0.2]} />
          <meshPhongMaterial color="#ff6b35" />
        </mesh>
        
        {/* End effector */}
        <mesh position={[2.3, 1.3, 0]}>
          <boxGeometry args={[0.3, 0.3, 0.15]} />
          <meshPhongMaterial color="#ffdd44" />
        </mesh>
      </group>
      <OrbitControls />
    </Canvas>
  );
};

export default RobotArm;
