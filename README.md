<h1 align="center">🦾 LeLab</h1>

<p align="center">
  <b>The official graphical interface for <a href="https://github.com/huggingface/lerobot">LeRobot</a>.</b>
</p>

<div align="center">

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/huggingface/leLab/blob/main/LICENSE)
[![HF Space](https://img.shields.io/badge/🤗-Open%20in%20Spaces-yellow)](https://huggingface.co/spaces/lerobot/LeLab)
[![Discord](https://img.shields.io/badge/Discord-Join_Us-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/q8Dzzpym3f)

</div>

**LeLab** is a web app that puts the full LeRobot workflow — calibrate, teleoperate, record, train, replay — into a single browser UI. Plug in your arm, open the app, and go. No CLI gymnastics, no keyboard prompts.

🤗 A web-native front door to LeRobot, designed so newcomers can get from "unboxing" to "training their first policy" in minutes.

🤗 Install and run everything with a single command.

## Quick Start

Grab the one-liner from the [LeLab Space](https://huggingface.co/spaces/lerobot/LeLab) — it installs and runs LeLab + LeRobot in a single command.

A page will automatically open in your browser and you are ready to go.

## What you can do

<div align="center">
  <table>
    <tr>
      <td>🎯 <b>Calibrate</b></td>
      <td>Guided web flow for both arms — no keyboard prompts.</td>
    </tr>
    <tr>
      <td>🕹️ <b>Teleoperate</b></td>
      <td>Move the leader, the follower mirrors it. Live joint streaming.</td>
    </tr>
    <tr>
      <td>📹 <b>Record</b></td>
      <td>Capture episodes into a LeRobotDataset, with cameras.</td>
    </tr>
    <tr>
      <td>🔎 <b>Browse</b></td>
      <td>Watch the episodes of a dataset on disk — every camera, frame by frame, with a joint-motion trace. No upload required.</td>
    </tr>
    <tr>
      <td>🧠 <b>Train</b></td>
      <td>Kick off a LeRobot training job, watch logs live.</td>
    </tr>
    <tr>
      <td>🤖 <b>Run inference</b></td>
      <td>Execute a trained policy on the follower.</td>
    </tr>
    <tr>
      <td>⏪ <b>Replay</b></td>
      <td>Re-run any recorded episode.</td>
    </tr>
    <tr>
      <td>☁️ <b>Upload</b></td>
      <td>Push your dataset to the <a href="https://huggingface.co/">Hugging Face Hub</a> in one click.</td>
    </tr>
  </table>
</div>

## Resources

- **[LeRobot](https://github.com/huggingface/lerobot):** the underlying library — go here for everything beyond the UI.
- **[LeLab Space](https://huggingface.co/spaces/lerobot/LeLab):** try the UI in your browser.
- **[Discord](https://discord.gg/q8Dzzpym3f):** chat with the LeRobot community.
- **[CLAUDE.md](CLAUDE.md):** architecture rundown for contributors.

## Contribute

PRs welcome. Hot-reload mode for working on the code:

```bash
lelab --dev
```

Vite on `:8080`, uvicorn `--reload` on `:8000`.

<div align="center">
<sub>Originally hacked together by <a href="https://www.linkedin.com/posts/nicolas-rabault-_lerobot-hackathon-lerobot-ugcPost-7341065019368828930-jTnl/">Team LeLab at the 2025 LeRobot Worldwide Hackathon 🏆</a>, now maintained by the <a href="https://huggingface.co/lerobot">LeRobot</a> team at <a href="https://huggingface.co">Hugging Face</a> with ❤️</sub>
</div>
