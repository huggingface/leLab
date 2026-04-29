
// Generate mock sensor data
export const generateSensorData = () => {
  const time = Date.now();
  return {
    time: time % 10000,
    sensor1: Math.sin(time / 1000) * 50 + 50,
    sensor2: Math.cos(time / 1500) * 30 + 70,
    sensor3: Math.sin(time / 800) * 40 + 60,
    sensor4: Math.cos(time / 1200) * 35 + 65,
  };
};

// Generate mock motor data
export const generateMotorData = () => {
  const time = Date.now();
  return {
    time: time % 10000,
    motor1: Math.sin(time / 1000) * 20 + 30,
    motor2: Math.cos(time / 1200) * 25 + 45,
    motor3: Math.sin(time / 900) * 30 + 50,
    motor4: Math.cos(time / 1100) * 22 + 35,
    motor5: Math.sin(time / 1300) * 28 + 40,
    motor6: Math.cos(time / 1400) * 26 + 42,
  };
};
