"""
Calibration module for the web interface.

This module provides calibration functionality similar to the CLI calibrate.py,
but adapted for the web interface with step-by-step guidance.
"""

import logging
import threading
import time
import traceback
from dataclasses import asdict, dataclass
from typing import Optional, Dict, Any

from lerobot.robots import (
    Robot,
    RobotConfig,
    make_robot_from_config,
)
from lerobot.teleoperators import (
    Teleoperator,
    TeleoperatorConfig,
    make_teleoperator_from_config,
)
from lerobot.motors import MotorCalibration
from lerobot.motors.feetech import OperatingMode
from lerobot.utils.utils import init_logging

logger = logging.getLogger(__name__)


@dataclass
class CalibrationStatus:
    """Status information for calibration process"""
    calibration_active: bool = False
    status: str = "idle"  # "idle", "connecting", "recording", "completed", "error", "stopping"
    device_type: Optional[str] = None
    error: Optional[str] = None
    message: str = ""
    step: int = 0  # Current calibration step
    total_steps: int = 1  # Total number of calibration steps
    current_positions: Dict[str, float] = None
    recorded_ranges: Dict[str, Dict[str, float]] = None  # {motor: {min: val, max: val, current: val}}


@dataclass
class CalibrationRequest:
    """Request parameters for starting calibration"""
    device_type: str  # "robot" or "teleop"
    port: str
    config_file: str


class CalibrationManager:
    """Manages calibration process for the web interface"""

    def __init__(self):
        self.status = CalibrationStatus()
        self.device: Optional[Robot | Teleoperator] = None
        self.calibration_thread: Optional[threading.Thread] = None
        self.stop_calibration = False
        self._status_lock = threading.Lock()
        self._step_complete = threading.Event()
        self._recording_active = False
        self._start_positions = {}
        self._mins = {}
        self._maxes = {}
        self._homing_offsets = {}
        
        # Initialize logging
        init_logging()

    def get_status(self) -> CalibrationStatus:
        """Get current calibration status"""
        with self._status_lock:
            # Update current positions if we're recording and device is connected
            if self.status.status == "recording" and self.device and self.device.is_connected:
                try:
                    # Try reading positions with quick retry on port contention
                    positions = None
                    for attempt in range(2):  # Quick retry for status updates
                        try:
                            positions = self.device.bus.sync_read("Present_Position", normalize=False)
                            break
                        except Exception as read_error:
                            if "Port is in use" in str(read_error) and attempt < 1:
                                time.sleep(0.005)  # Very short delay
                                continue
                            else:
                                raise read_error
                    
                    if positions:
                        # Update recorded ranges
                        if not self.status.recorded_ranges:
                            self.status.recorded_ranges = {}
                        
                        for motor, pos in positions.items():
                            # Filter out invalid readings (0, negative, or extreme values)
                            if pos <= 0 or pos >= 5000:
                                continue  # Skip invalid readings
                                
                            if motor not in self.status.recorded_ranges:
                                self.status.recorded_ranges[motor] = {
                                    "min": pos, "max": pos, "current": pos
                                }
                            else:
                                self.status.recorded_ranges[motor]["current"] = pos
                                self.status.recorded_ranges[motor]["min"] = min(
                                    self.status.recorded_ranges[motor]["min"], pos
                                )
                                self.status.recorded_ranges[motor]["max"] = max(
                                    self.status.recorded_ranges[motor]["max"], pos
                                )
                except Exception as e:
                    # Reduce log spam by using debug level for expected port contention
                    if "Port is in use" in str(e):
                        logger.debug(f"Port busy during position read: {e}")
                    else:
                        logger.warning(f"Failed to read positions: {e}")
            
            return self.status

    def _update_status(self, **kwargs):
        """Update calibration status thread-safely"""
        with self._status_lock:
            for key, value in kwargs.items():
                if hasattr(self.status, key):
                    setattr(self.status, key, value)

    def start_calibration(self, request: CalibrationRequest) -> Dict[str, Any]:
        """Start calibration process"""
        try:
            if self.status.calibration_active:
                return {"success": False, "message": "Calibration already active"}

            # Reset status and clear any previous calibration data
            self._start_positions = {}
            self._mins = {}
            self._maxes = {}
            self._homing_offsets = {}
            
            self._update_status(
                calibration_active=True,
                status="connecting",
                device_type=request.device_type,
                error=None,
                message=f"Starting calibration for {request.device_type}",
                step=0,
                current_positions=None,
                recorded_ranges=None
            )

            # Start calibration in a separate thread
            self.calibration_thread = threading.Thread(
                target=self._calibration_worker,
                args=(request,),
                daemon=True
            )
            self.stop_calibration = False
            self._step_complete.clear()
            self.calibration_thread.start()

            return {"success": True, "message": "Calibration started"}

        except Exception as e:
            logger.error(f"Error starting calibration: {e}")
            self._update_status(
                calibration_active=False,
                status="error",
                error=str(e),
                message="Failed to start calibration"
            )
            return {"success": False, "message": str(e)}

    def complete_step(self) -> Dict[str, Any]:
        """Complete the current calibration step"""
        try:
            if not self.status.calibration_active:
                return {"success": False, "message": "No calibration active"}

            if self.status.status == "recording":
                # Complete recording step
                self._recording_active = False
                self._step_complete.set()
                return {"success": True, "message": "Range recording completed"}

            else:
                return {"success": False, "message": f"Cannot complete step in status: {self.status.status}"}

        except Exception as e:
            logger.error(f"Error completing step: {e}")
            return {"success": False, "message": str(e)}

    def stop_calibration_process(self) -> Dict[str, Any]:
        """Stop calibration process"""
        try:
            if not self.status.calibration_active:
                return {"success": False, "message": "No calibration active"}

            logger.info("Stopping calibration process...")
            self.stop_calibration = True
            self._recording_active = False
            self._step_complete.set()  # Unblock any waiting step
            
            self._update_status(
                status="stopping",
                message="Stopping calibration..."
            )

            # Wait for thread to finish
            if self.calibration_thread and self.calibration_thread.is_alive():
                self.calibration_thread.join(timeout=5.0)

            # Ensure cleanup is called if thread didn't finish properly
            if self.calibration_thread and self.calibration_thread.is_alive():
                logger.warning("Calibration thread did not finish within timeout, forcing cleanup")
            
            # Force cleanup and finish
            self._cleanup_and_finish("Calibration stopped", status="idle")
            
            logger.info("Calibration stop completed")
            return {"success": True, "message": "Calibration stopped"}

        except Exception as e:
            logger.error(f"Error stopping calibration: {e}")
            # Force cleanup on error too
            self._cleanup_and_finish("Calibration stopped with error", status="error")
            return {"success": False, "message": str(e)}

    def _calibration_worker(self, request: CalibrationRequest):
        """Worker thread for calibration process"""
        try:
            logger.info(f"Starting calibration worker for {request.device_type}")
            
            # Create device configuration
            if request.device_type == "robot":
                from lerobot.robots.so_follower import SO101FollowerConfig
                config = SO101FollowerConfig(
                    port=request.port,
                    id=request.config_file
                )
            elif request.device_type == "teleop":
                from lerobot.teleoperators.so_leader import SO101LeaderConfig
                config = SO101LeaderConfig(
                    port=request.port,
                    id=request.config_file
                )
            else:
                raise ValueError(f"Unknown device type: {request.device_type}")

            self._update_status(
                status="connecting",
                message="Connecting to device..."
            )

            # Create and connect device
            if request.device_type == "robot":
                self.device = make_robot_from_config(config)
            else:
                self.device = make_teleoperator_from_config(config)

            logger.info("Connecting to device...")
            self.device.connect(calibrate=False)

            if self.stop_calibration:
                logger.info("Calibration stopped after device connection")
                self._cleanup_and_finish("Calibration cancelled")
                return

            # Start Step 1: Homing
            self._step_homing()

            if self.stop_calibration:
                logger.info("Calibration stopped after homing step")
                self._cleanup_and_finish("Calibration cancelled")
                return

            # Start Step 2: Range Recording
            self._step_range_recording()

            if self.stop_calibration:
                logger.info("Calibration stopped after recording step")
                self._cleanup_and_finish("Calibration cancelled")
                return

            # Complete calibration
            self._complete_calibration()

            logger.info("Calibration completed successfully")
            self._cleanup_and_finish("Calibration completed successfully", status="completed")

        except Exception as e:
            logger.error(f"Calibration error: {e}")
            logger.error(traceback.format_exc())
            # Ensure cleanup happens even on error
            self._cleanup_and_finish(f"Calibration failed: {e}", status="error")
        finally:
            # Ensure we always clean up and reset the active flag
            logger.info("Calibration worker thread finishing")
            if self.status.calibration_active:
                logger.warning("Worker thread ending but calibration still marked as active - forcing cleanup")
                self._cleanup_and_finish("Calibration stopped", status="idle")

    def _step_homing(self):
        """Auto-capture homing offsets from the device's current position."""
        logger.info("Setting homing offsets from current position")

        # Disable torque to allow manual movement during recording
        self.device.bus.disable_torque()
        for motor in self.device.bus.motors:
            self.device.bus.write("Operating_Mode", motor, OperatingMode.POSITION.value)

        self.device.bus.reset_calibration()
        actual_positions = self.device.bus.sync_read("Present_Position", normalize=False)
        logger.info(f"Current positions for homing: {actual_positions}")

        self._homing_offsets = self.device.bus._get_half_turn_homings(actual_positions)
        logger.info(f"Calculated homing offsets: {self._homing_offsets}")

        for motor, offset in self._homing_offsets.items():
            self.device.bus.write("Homing_Offset", motor, offset)

    def _step_range_recording(self):
        """Record range of motion as the user moves all joints."""
        logger.info("Starting range recording step")
        
        # Initialize range tracking with retry and validation
        self._start_positions = {}
        for attempt in range(5):  # Try multiple times to get valid initial positions
            try:
                positions = self.device.bus.sync_read("Present_Position", normalize=False)
                # Validate initial positions
                valid_positions = {}
                for motor, pos in positions.items():
                    if pos > 0 and pos < 5000:  # Valid range
                        valid_positions[motor] = pos
                
                if len(valid_positions) == len(positions):  # All positions are valid
                    self._start_positions = valid_positions
                    break
                else:
                    logger.warning(f"Attempt {attempt + 1}: Got invalid initial positions, retrying...")
                    time.sleep(0.1)
            except Exception as e:
                logger.warning(f"Attempt {attempt + 1}: Failed to read initial positions: {e}")
                time.sleep(0.1)
        
        if not self._start_positions:
            raise RuntimeError("Could not get valid initial positions after multiple attempts")
        
        logger.info(f"Starting positions for range recording: {self._start_positions}")
        
        self._mins = self._start_positions.copy()
        self._maxes = self._start_positions.copy()
        logger.info(f"Initialized mins: {self._mins}")
        logger.info(f"Initialized maxes: {self._maxes}")
        
        self._update_status(
            status="recording",
            step=1,
            message="Move ALL joints through their FULL ranges of motion - from minimum to maximum positions. Ensure each joint moves significantly from its starting position.",
            recorded_ranges={motor: {"min": pos, "max": pos, "current": pos} 
                           for motor, pos in self._start_positions.items()}
        )

        self._recording_active = True

        # Record positions until user completes step
        while not self._step_complete.is_set() and not self.stop_calibration:
            try:
                # Try reading positions with retry on port contention
                positions = None
                for attempt in range(3):  # Try up to 3 times
                    try:
                        positions = self.device.bus.sync_read("Present_Position", normalize=False)
                        break  # Success, exit retry loop
                    except Exception as read_error:
                        if "Port is in use" in str(read_error) and attempt < 2:
                            time.sleep(0.01)  # Short delay before retry
                            continue
                        else:
                            raise read_error  # Re-raise if not port contention or final attempt
                
                if positions:
                    # Validate the readings - filter out invalid/zero values
                    valid_positions = {}
                    for motor, pos in positions.items():
                        # Filter out clearly invalid readings (0, negative, or extreme values)
                        if pos > 0 and pos < 5000:  # Reasonable range for motor positions
                            valid_positions[motor] = pos
                        else:
                            logger.debug(f"Filtered invalid position for {motor}: {pos}")
                    
                    # Only update if we have valid readings
                    if valid_positions:
                        for motor, pos in valid_positions.items():
                            if motor in self._mins:
                                self._mins[motor] = min(self._mins[motor], pos)
                                self._maxes[motor] = max(self._maxes[motor], pos)
                
                time.sleep(0.05)  # 20Hz update rate
            except Exception as e:
                if "Port is in use" in str(e):
                    logger.debug(f"Port busy during position read: {e}")
                else:
                    logger.warning(f"Error reading positions during recording: {e}")
                # Increase sleep time on error to reduce port contention
                time.sleep(0.2)

        if self.stop_calibration:
            logger.info("Range recording step cancelled due to stop request")
            return
                
        # Log the final recorded ranges for debugging
        logger.info("Final recorded ranges:")
        for motor in self._mins.keys():
            logger.info(f"  {motor}: min={self._mins[motor]}, max={self._maxes[motor]}, range={self._maxes[motor] - self._mins[motor]}")

        # Validate ranges
        same_min_max = [motor for motor in self._mins.keys() if self._mins[motor] == self._maxes[motor]]
        if same_min_max:
            raise ValueError(f"Some motors have the same min and max values: {same_min_max}")

        # Check for insufficient range movement (less than 100 motor steps)
        insufficient_range = []
        for motor in self._mins.keys():
            range_diff = self._maxes[motor] - self._mins[motor]
            if range_diff < 100:  # Less than 100 motor steps seems insufficient
                insufficient_range.append(f"{motor}: {range_diff}")
        
        if insufficient_range:
            logger.warning(f"Some motors may not have been moved through sufficient range: {insufficient_range}")
            logger.warning("Consider moving all joints through their full range of motion during calibration")

        self._step_complete.clear()
        logger.info("Range recording step completed")

    def _complete_calibration(self):
        """Complete the calibration and save results"""
        logger.info("Completing calibration...")

        # Log motor information for debugging
        logger.info("Motor configuration:")
        for motor, m in self.device.bus.motors.items():
            logger.info(f"  {motor}: ID={m.id}, Model={m.model}")

        # Create calibration dict
        calibration = {}
        for motor, m in self.device.bus.motors.items():
            calibration[motor] = MotorCalibration(
                id=m.id,
                drive_mode=0,
                homing_offset=self._homing_offsets[motor],
                range_min=self._mins[motor],
                range_max=self._maxes[motor],
            )
            logger.info(f"Calibration for {motor}: "
                       f"ID={m.id}, "
                       f"homing_offset={self._homing_offsets[motor]}, "
                       f"range_min={self._mins[motor]}, "
                       f"range_max={self._maxes[motor]}")

        # Write and save calibration
        self.device.calibration = calibration
        self.device.bus.write_calibration(calibration)
        self.device._save_calibration()
        
        logger.info(f"Calibration saved to {self.device.calibration_fpath}")

    def _cleanup_and_finish(self, message: str, status: str = "completed"):
        """Clean up and finish calibration"""
        self._cleanup_device()
        self._recording_active = False
        self._update_status(
            calibration_active=False,
            status=status,
            message=message
        )

    def _cleanup_device(self):
        """Clean up device connection"""
        try:
            if self.device:
                logger.info("Disconnecting device...")
                self.device.disconnect()
                self.device = None
        except Exception as e:
            logger.error(f"Error disconnecting device: {e}")


# Global calibration manager instance
calibration_manager = CalibrationManager() 
