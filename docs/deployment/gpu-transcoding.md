# GPU-accelerated transcoding

OpenHearth transcodes local media to H.264/AAC with ffmpeg only when the browser
can't direct-play a file (see [config-reference § `transcode`](../config-reference.md#transcode)).
**CPU encoding (`libx264`) is the default and the guaranteed path** — GPU
acceleration is strictly opt-in and host-specific.

> **TL;DR.** Leave `transcode.hwaccel: none` (the default) and it just works on
> CPU. Turn on a GPU backend only if you have the hardware, you've mapped the
> device into the container, and you've verified it (below). A misconfigured GPU
> is the most common cause of "playback won't start".

---

## CPU is the default (and the fallback)

With no `transcode` config — or `hwaccel: none` — every transcode uses
`libx264 -preset veryfast`. This requires no devices, no drivers, and works on
every host. It is the path the automated tests exercise (`buildFfmpegArgs`
defaults to `libx264`), and the one we guarantee.

You only need the rest of this document if CPU transcoding can't keep up (e.g.
multiple simultaneous 4K transcodes on a low-power mini-PC).

There is **no automatic CPU fallback at runtime** if a configured GPU backend
fails: a bad GPU config surfaces as a failed transcode, not a silent downgrade.
If playback stops working after enabling a backend, set `hwaccel: none` and
restart to confirm the CPU path, then debug the GPU setup with the checks below.

---

## Enabling a backend

Two steps, always:

1. **Map the device into the container** (docker-compose).
2. **Select the backend** in `config/openhearth.yaml`:

   ```yaml
   transcode:
     hwaccel: vaapi # none | vaapi | nvenc | qsv
     device: /dev/dri/renderD128 # VAAPI/QSV only
   ```

Restart the container after changing `transcode` (it's read at startup).

### VAAPI — Intel / AMD on Linux (recommended GPU path)

The smoothest GPU path. Uses the kernel's `/dev/dri` render node.

```yaml
services:
  openhearth:
    # …
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - '44' # the host's "video" group gid
      - '105' # the host's "render" group gid (varies by distro)
```

```yaml
# config/openhearth.yaml
transcode:
  hwaccel: vaapi
  device: /dev/dri/renderD128
```

Find your render node and group gids on the host:

```sh
ls -l /dev/dri            # renderD128 is the usual node
getent group render video # gids to put in group_add
```

### NVENC — NVIDIA

Requires the host's NVIDIA driver and the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
No `device:` field is needed (the toolkit injects the GPU).

```yaml
services:
  openhearth:
    # …
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, video]
```

```yaml
# config/openhearth.yaml
transcode:
  hwaccel: nvenc
```

### QSV — Intel Quick Sync

Intel iGPUs via the same `/dev/dri` mapping as VAAPI; QSV can outperform VAAPI on
recent Intel hardware.

```yaml
devices:
  - /dev/dri:/dev/dri
```

```yaml
# config/openhearth.yaml
transcode:
  hwaccel: qsv
  device: /dev/dri/renderD128
```

---

## Verifying it's active

1. **Server logs.** Start a transcode (play a file the browser can't direct-play,
   e.g. an `.mkv` with HEVC) and watch the container logs — an ffmpeg error
   mentioning the device or encoder means the GPU path is wrong.
2. **Inspect the encoder.** The configured backend selects the ffmpeg encoder
   (`h264_vaapi`, `h264_nvenc`, `h264_qsv`) instead of `libx264`.
3. **Host-side tools:**
   - VAAPI/QSV: `vainfo` should list `VAEntrypointEncSlice` for H.264.
   - NVENC: `nvidia-smi` should show the `ffmpeg` process under "Processes"
     during a transcode.
4. **CPU sanity check.** Set `hwaccel: none`, restart, and confirm the same file
   still transcodes — that's the guaranteed baseline.

---

## Windows / WSL2 — known-hard

Per [PRD §18](../prd.md), GPU passthrough into Docker on **Windows/WSL2 is
explicitly a known-hard area** and is not a supported configuration:

- VAAPI/`/dev/dri` is generally **not** available to WSL2 containers.
- NVENC under WSL2 needs a recent driver + the CUDA-on-WSL stack and is fiddly.

**Recommendation:** for GPU transcoding, run OpenHearth on a **Linux host**. On
Windows, use the CPU path (`hwaccel: none`) — it's fully supported and needs no
GPU setup. CPU transcoding is sufficient for typical single-stream living-room
playback.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Playback never starts on a transcoded file | GPU configured but device not mapped / wrong node | Verify `devices:` mapping and `transcode.device`; or set `hwaccel: none` |
| `Permission denied` on `/dev/dri/renderD128` | container user not in the render/video group | add the host gids to `group_add` |
| Works on CPU, fails on GPU | encoder/driver mismatch | confirm `vainfo`/`nvidia-smi` on the host; check the encoder name in logs |
| 4K stutters on CPU | CPU can't keep up | enable a GPU backend (above) |
