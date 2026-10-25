
import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Stars, Sparkles } from "@react-three/drei";

function HolographicCore() {
  const core = useRef();
  const ring1 = useRef();
  const ring2 = useRef();

  useFrame((state, delta) => {
    if (core.current) {
      core.current.rotation.y += delta * 0.18;
      core.current.rotation.x =
        Math.sin(state.clock.elapsedTime * 0.3) * 0.12;
    }

    if (ring1.current) {
      ring1.current.rotation.x += delta * 0.12;
      ring1.current.rotation.y += delta * 0.2;
    }

    if (ring2.current) {
      ring2.current.rotation.x -= delta * 0.16;
      ring2.current.rotation.z += delta * 0.12;
    }
  });

  return (
    <group>
      <Float
        speed={1.5}
        rotationIntensity={0.18}
        floatIntensity={0.45}
      >
        <mesh ref={core}>
          <icosahedronGeometry args={[1.12, 3]} />
          <meshPhysicalMaterial
            color="#168cff"
            emissive="#063eac"
            emissiveIntensity={1.3}
            metalness={0.35}
            roughness={0.17}
            transmission={0.2}
            thickness={1.4}
            clearcoat={1}
            clearcoatRoughness={0.08}
            flatShading
          />
        </mesh>

        <mesh scale={0.77}>
          <icosahedronGeometry args={[1.12, 2]} />
          <meshBasicMaterial
            color="#80f4ff"
            wireframe
            transparent
            opacity={0.48}
          />
        </mesh>
      </Float>

      <mesh ref={ring1} rotation={[0.8, 0.25, 0.3]}>
        <torusGeometry args={[1.62, 0.009, 12, 180]} />
        <meshBasicMaterial color="#4be7ff" />
      </mesh>

      <mesh ref={ring2} rotation={[1.3, 0.8, 0.1]}>
        <torusGeometry args={[1.85, 0.006, 12, 180]} />
        <meshBasicMaterial
          color="#3478ff"
          transparent
          opacity={0.8}
        />
      </mesh>

      <mesh position={[1.2, 0.8, 0.5]}>
        <sphereGeometry args={[0.065, 20, 20]} />
        <meshBasicMaterial color="#b9fbff" />
      </mesh>

      <mesh position={[-1.5, -0.4, 0.4]}>
        <sphereGeometry args={[0.045, 20, 20]} />
        <meshBasicMaterial color="#66aaff" />
      </mesh>

      <pointLight color="#087cff" intensity={16} distance={8} />
      <pointLight
        position={[2, 2, 2]}
        color="#54eaff"
        intensity={10}
        distance={6}
      />
    </group>
  );
}

export default function HeroScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5.5], fov: 42 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={1.2} />
      <pointLight
        position={[-3, 2, 3]}
        intensity={3}
        color="#155eef"
      />

      <Stars
        radius={65}
        depth={35}
        count={1100}
        factor={2}
        fade
        speed={0.6}
      />

      <Sparkles
        count={90}
        scale={5}
        size={2.5}
        speed={0.3}
        color="#71dfff"
      />

      <HolographicCore />
    </Canvas>
  );
}
