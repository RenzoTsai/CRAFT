# CRAFT: Exploring Wearable Creative AI on Smart Glasses for Fiction Writing in Real-World Contexts

CRAFT is a new approach for wearable creative AI to support fiction writing  in real-world contexts. In this repo, we present a technology probe that realizes this approach. It supports plot ideation, photo and voice-based authoring, contextual questions, proactive suggestions, character role-play, scene and portrait generation, plot graph editing, and draft generation and revision.

## Publications

- [CRAFT: Exploring Wearable Creative AI on Smart Glasses for Fiction Writing in Real-World Contexts](https://dl.acm.org/doi/10.1145/3831952), **IMWUT/UbiComp 2026**.
  - [PDF](https://dl.acm.org/doi/pdf/10.1145/3831952?download=true).

> Runze Cai, Yuxuan Huang, Lin-Ping Yuan, Kexin Xiang, David Hsu, Collier Nogues, Jussi Holopainen, and Shengdong Zhao. 2026. CRAFT: Exploring Wearable Creative AI on Smart Glasses for Fiction Writing in Real-World Contexts. Proc. ACM Interact. Mob. Wearable Ubiquitous Technol. 10, 3, Article 81 (September 2026), 34 pages. https://doi.org/10.1145/3831952

Deprecated Gemini models used in the paper have been replaced with the latest available Gemini versions in this release.

## Install and launch

Requires **Python 3.11 or 3.12**, **Node.js 20.9 or later**, and a recent Chrome or Edge browser with WebGPU for local Whisper transcription.

```sh
cp .env.example .env
# Add your GEMINI_API_KEY and OPENAI_API_KEY to .env.
python3.11 install.py
.venv/bin/python run.py
```

Open **http://127.0.0.1:3000**. On macOS, subsequent launches can also use **start.command**. The launcher runs the Next.js React interface on port 3000 and the Python API on port 8000, and stops both when you press Ctrl+C. If either port is occupied, stop the existing instance before starting another.

The two API keys enable Gemini generation and OpenAI speech playback, respectively. Values in the project-root `.env` take precedence over existing environment variables when launching CRAFT or running the Python API directly. Model IDs are configurable in `.env`. The local MobileNet, MiniLM and Whisper models download on first use. Installation and initial model loading require network access and several gigabytes of free disk space.

### Camera and hardware

#### Connect Pupil Core

Run Pupil Capture and CRAFT on the same computer for the following setup. CRAFT uses the world-camera feed.

1. **Connect the headset.** Install Pupil Capture using the [official getting-started guide](https://docs.pupil-labs.com/core/getting-started/), connect Pupil Core by USB, and open Pupil Capture. Confirm that its World window shows a live camera image before continuing.
2. **Enable streaming.** In the World window's Plugin Manager, enable **Network API**. In its **Pupil Remote** section, check the listening address and port; the CRAFT defaults below use `127.0.0.1:50020`. In **Frame Publisher**, select **BGR**. CRAFT decodes raw three-channel BGR frames, so this format must match. Pupil Remote and Frame Publisher are sections of the [Network API plugin](https://docs.pupil-labs.com/core/software/pupil-capture/#network-api-plugin).
3. **Configure CRAFT.** Set these values in the project-root `.env`, keeping your existing API keys:

   ```dotenv
   CRAFT_CAMERA=pupil
   PUPIL_HOST=127.0.0.1
   PUPIL_PORT=50020
   ```

4. **Start CRAFT after Pupil Capture.** Keep Pupil Capture open throughout the session. From the CRAFT directory, run:

   ```sh
   .venv/bin/python run.py
   ```

   Open [CRAFT](http://127.0.0.1:3000). Restart CRAFT after changing these connection settings, or if Pupil Capture was unavailable when CRAFT started. Pupil Capture's recording button is not required for CRAFT's live camera input.
5. **Check the connection.** The backend should log `Successfully connected to Pupil Capture`. Open the [camera check](http://127.0.0.1:3000/backend/image) and refresh it after moving the headset: each refresh should return the latest world-camera image. In CRAFT, press the down arrow while idle to capture a photo.

**Troubleshooting**

- **No video in Pupil Capture:** resolve USB, camera access or driver issues in Pupil Capture first. On macOS 12 and later, the [official camera-access instructions](https://docs.pupil-labs.com/core/software/pupil-capture/#macos-12-monterey-and-newer) specify launching Pupil Capture from Terminal with administrator privileges:

  ```sh
  sudo "/Applications/Pupil Capture.app/Contents/MacOS/pupil_capture"
  ```

  Enter the password in your own terminal. Start CRAFT with its regular launch command above.
- **Connection error:** confirm Pupil Capture is running, Network API is enabled, and `PUPIL_HOST` / `PUPIL_PORT` match Pupil Remote. Then restart CRAFT.
- **Connected but camera check returns 503:** confirm the World preview is live and Frame Publisher uses BGR. Refresh the camera check once frames arrive.

For a second computer, set `PUPIL_HOST` to the computer running Pupil Capture and bind Pupil Remote to a reachable network interface. CRAFT queries the session's subscription port automatically; the network must allow that port as well as Pupil Remote. See the [official Network API documentation](https://docs.pupil-labs.com/core/developer/network-api/#ipc-backbone).

#### Other hardware

- **Computer webcam:** set `CRAFT_CAMERA=webcam` and grant camera permission to Python when prompted.
- **No camera:** set `CRAFT_CAMERA=off` for voice-based writing sessions.
- The interface can be mirrored to Xreal glasses. A ring that sends arrow keys uses the same controls as the keyboard.

`CRAFT_LOCATION` can supply a fixed location. Otherwise, the backend uses the native macOS location provider or IP-based location on other systems. Grant location permission when requested.

The interface scales as one display stage in landscape windows, including Android WebView and glasses displays. Card positions, type, spacing, and controls scale together; resizing and rotation use the available viewport and safe-area insets. The role-play card stays horizontally centered while its listening panel appears on the right.


## Interaction

The interface starts with a black background. Click the background to show or hide the directional controls.

| Control | Action |
| --- | --- |
| Right arrow | Start speaking; press again to submit the recording and transcription |
| Down arrow while idle | Capture a photo and start recording a description |
| Up arrow while idle | Select moments from the story context |
| Up arrow on a scene or generated image | Enter role-play |
| Up / down arrows in plot ideation or writing views | Toggle speech / text display |
| Left arrow in role-play | Exit and reset the interface, including its directional icons |
| Escape in role-play | End role-play and return to the idle view |
| Left arrow elsewhere | Reset the current interface and stop playback |

Speak to construct a plot, develop the captured scene, ask contextual questions, or request role-play. The interface displays the corresponding photo, question, plot, generated-image or role-play card. Proactive suggestions appear only while the author is idle, and fade after 30 seconds. Starting an interaction clears the current suggestion and pauses proactive generation.

- **Settings:** click the small **i** button at the bottom right to select the project ID, response language, writing style, suggestion priority and microphone. Use the search button to retrieve a project's settings, then **Save** to apply them.
- **Writing editor:** move the pointer to the bottom-left corner to reveal the circular **e** button. The editor contains the generated draft, feedback controls and an editable draft. Generate or revise a draft, then save your edits and update the fiction context.
- **Plot graph:** choose **SHOW PLOT** in the editor or request it by voice. Edit or delete moments, drag nodes, connect or reconnect edges, and use **Save Plot Connections** to update the context.

## Files and context

Each project stores its runtime files under `backend/data/<project-id>/`:

```text
config.json           # Language, style and suggestion settings
context_data.json     # User, environment and fiction context
story_history.json    # Generated and user-saved draft history
suggestion_history.json
                      # Suggestions and their environmental context
event_log.txt         # Transcriptions, responses and file events
images/               # Captured images
generated_images/     # Transformed scene images
roleplay_portraits/    # Character portraits
temp/                 # Recorded voice inputs
```

The fiction context contains plot, characters, setting, scenes, style, writing preferences and plot connections. Authoring exchanges, graph edits, image generation and saved draft revisions update the relevant context through the Python context updater. To reopen a project, retrieve its ID in Settings. To move its data to another installation, copy the entire project folder.

Gemini receives the text, image, audio and context required by the active workflow. OpenAI receives text for speech generation. Whisper transcription runs locally in the browser. Runtime data, API keys, model caches and installed dependencies are excluded by `.gitignore`.

## Development

The main interface is `frontend/src/app/page.tsx`; its cards and writing editor are in `frontend/src/app/components/`. The plot graph is in `frontend/src/components/ui/PlotDemonstration.tsx`. Python request handling is in `backend/main.py`, contextual updates in `backend/action/update_fiction_context.py`, and JSON persistence in `backend/storage/context_storage.py`.

For frontend development, run the Python API and Next.js separately:

```sh
# Terminal 1, from the project root:
.venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000

# Terminal 2:
cd frontend
npm run dev
```

The web interface forwards `/backend/` requests to the Python API. If you change `CRAFT_PORT`, rebuild the frontend with `install.py` so the proxy uses the new port. Configure `OPENAI_API_KEY` in the frontend development terminal for speech playback. This probe is intended for a single local research session and has no user-account system.

## License

The source code is available under the [MIT License](LICENSE).
