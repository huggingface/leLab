# Mobile camera calibration target

First milestone for [nori_ws issue 52](https://github.com/Nori-Robotics/nori_ws/issues/52).

Open `/nori/calibration-target` on the hosted Nori Lab frontend, or on a development-server address reachable from the phone. Home and the mobile menu’s **Calibration Tools** item link to it. A computer's `localhost` address cannot be opened from another device.

The target mounts independently of API, sign-in, WebRTC, and robot-control providers. It needs neither camera permission nor a robot connection. It draws a measured target; it does not capture images, fit camera calibration, install files, or move the robot. This is the mobile-target milestone, not completion of the autocalibration wizard.

## Operator procedure

1. Have a millimetre ruler ready. Clean the phone's screen, set steady brightness, and avoid reflections. Turn the phone sideways and lock screen rotation in landscape if supported. Keep that orientation throughout calibration; if the phone cannot lock landscape, keep it sideways to prevent rotation. Use normal browser zoom.
2. Adjust the horizontal line until the distance between its end ticks measures **40 mm** against the ruler. Confirm.
3. Verify that the vertical line, at the same scale, also measures **40 mm**. If it does not, go back and repeat; do not independently stretch one axis.
4. Choose **Overhead** or **Front**, then a requested square edge of **4, 5, 6, 8, or 10 mm**. The default is 6 mm. These are target sizes to evaluate, not a claim that every size is detectable across the full work volume.
5. Select **Show checkerboard**. The page attempts fullscreen and uses screen wake lock where supported. If fullscreen is unavailable, it displays only when the complete target fits. Keep the screen awake manually if necessary.
6. Hold the whole target toward the selected camera. Follow the existing camera-calibration procedure on the computer. This first milestone supplies no automated capture or movement guidance.
7. Tap anywhere on the target, or press Escape, to return to setup. Read **Calibration tool values** for the exact `--size` (inner corners across × down) and `--square` (metres), or copy its board arguments. Confirm the default camera name against the robot’s actual settings. Select **Download target details** and preserve the JSON beside the camera observations.

The displayed target uses as many whole rows and columns as fit the available screen, with a white border one square wide on every side and 16 CSS pixels of extra clearance within the board area above the values strip. Square counts have opposite parity to distinguish the board axes. Counts are chosen after attempting fullscreen and frozen for that display run; any subsequent clipping pauses the target. Showing it again in a different viewport may produce different counts, so restart the calibration tool if the counts change. The checkerboard canvas and its white border contain no controls or text. A separate 72 CSS pixel strip below it shows the same run’s `--size`, exact `--square` in metres, default `--camera_name`, and decoded image topic. This strip is reserved before fitting the grid, so it cannot cover squares or the white border. Tap anywhere to return to setup; the detailed/copyable values remain available there. All squares use one integer number of canvas backing pixels; both spacing and origin align to that grid. The page never stretches or shrinks squares to fit; it adds whole rows and columns instead.

## Rechecking and interrupted display

An operator-verified profile is saved locally when storage is available. It is reused only for the same screen dimensions, DPR, orientation, and zoom. Changing those mappings invalidates verification and pauses the target. A viewport becoming too small, closing fullscreen, or backgrounding the page pauses display and requires an explicit restart. Browser toolbar changes that leave the physical mapping intact may resume only through **Show checkerboard** if they caused clipping.

Stored profiles are operator assertions, not metrology certificates. Repeat the ruler check after browser/OS changes, when the phone has been replaced, or whenever sizing is uncertain. Browser detection cannot identify all physical-display changes, including a replacement panel with a different pixel pitch. Printed-board/independent physical validation remains required before trusting results for robot tasks.

## Target details contract

`screenTarget.ts` defines the version-1 `nori_screen_checkerboard` JSON artifact. The record is generated when the board is shown and retained for download after display stops. The visible Calibration tool values and copyable board arguments come from that same frozen record, rather than the potentially different setup preview. Changing role, square size, or verified screen mapping clears the record.

Important fields:

| Field | Meaning |
|---|---|
| `target_id` | Identifier for that display run |
| `camera_role` | `front` or `overhead`, as selected by the operator |
| `inner_corners` | Actual inner intersections across/down for that display run; use these for `--size`, not square counts |
| `square_size_m` | Actual square edge after rounding to whole backing pixels; use this for fitting and pose estimation |
| `requested_square_size_m` | Operator's requested edge before pixel rounding |
| `pattern_size_m` | Dimensions of the black-and-white pattern |
| `outer_size_m` | Pattern plus uninterrupted white border |
| `render` | Square size and complete canvas size in backing pixels |
| `screen` | Operator-verified CSS-pixels/mm scale, verification time/method, and browser mapping; no phone identity required |
| `status` | Always `target_only_camera_calibration_not_performed` |

There is no phone-model selection or device lookup. Every screen starts with the same generic line length and must pass both ruler checks. Actual square size depends on the **operator-verified** scale and whole-pixel rounding; the initial line length is not a physical measurement. Previously saved ruler-verified profiles remain usable when the browser mapping still matches, but legacy phone-model labels are discarded. The phone is a display target, not an external pose reference, and its inertial sensors are not used.

## Integration boundaries

The next milestone belongs in `nori_ws/src/nori_calibration`: consume role-specific original JPEGs, import the target geometry, select useful frames, fit and independently validate camera models, and emit candidate results. Use the existing installer/checker for accepted per-unit camera records. Preview video crops must not become geometry inputs without an explicitly matched pixel mapping.

Future wizard/SDK/gateway work must keep the phone target distinct from the laptop's robot-control session. Front and overhead are mandatory calibration roles; wrists are an optional future branch. A calibration profile can reference `lift_top_link` for an upper-body-relative spheroid, or a registered fixed work frame. Planned URDF target poses are not independent measurement evidence.

## Validation

Run `npm test -- src/nori/calibration/screenTarget.test.ts` and `npm run build` from `frontend`. Unit checks cover dimensions/rounding, corner and border geometry, corrupt/stale profiles, scaling changes, filling a wide phone viewport, matching variable grid counts to calibration arguments, reserving space for the visible tool values, and refusing to shrink or reflow an active target.

Browser checks must cover normal and blocked storage, unsupported fullscreen/wake lock, portrait and landscape, zoom/orientation invalidation, target clipping, plain-HTTP LAN display, and manifest download. Physical Pixel 6 validation remains separate: verify dimensions with a ruler, capture front/overhead views at required distances and tilts, inspect screen artifacts, and compare calibration against a measured printed reference target. Software checks cannot establish physical size or optical accuracy.

Sources: [CSS physical-unit caveat](https://www.w3.org/TR/css-values-4/#absolute-lengths), [DPR and zoom](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio).
