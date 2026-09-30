"""Start the CRAFT web interface and Python API."""

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv


def signal_process_tree(process, force=False):
    """Signal only the process group created for this service."""
    try:
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
        elif process.poll() is None:
            process.kill() if force else process.terminate()
    except ProcessLookupError:
        pass
    except PermissionError:
        if process.poll() is None:
            raise


def process_tree_running(process):
    process.poll()  # Reap the direct child before checking its descendants.
    if os.name == 'posix':
        try:
            os.killpg(process.pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # An existing group may be temporarily unsignalable during exit.
            return True
    return process.returncode is None


def stop_processes(processes):
    if not processes:
        return
    print('Stopping CRAFT...', flush=True)
    for process in processes:
        signal_process_tree(process)
    deadline = time.monotonic() + 10
    while any(process_tree_running(p) for p in processes):
        if time.monotonic() >= deadline:
            print('Shutdown timed out; stopping remaining CRAFT processes.', flush=True)
            for process in processes:
                signal_process_tree(process, force=True)
            break
        time.sleep(0.1)
    for process in processes:
        process.wait(timeout=5)
    print('CRAFT stopped.', flush=True)


def main():
    root = Path(__file__).resolve().parent
    load_dotenv(root / '.env', override=True)
    host = os.getenv('CRAFT_HOST', '127.0.0.1')
    api_port = int(os.getenv('API_PORT', os.getenv('CRAFT_PORT', '8000')))
    web_port = int(os.getenv('CRAFT_WEB_PORT', '3000'))
    if api_port == web_port:
        raise SystemExit('CRAFT_PORT and CRAFT_WEB_PORT must use different ports.')
    node = shutil.which('node')
    next_cli = root / 'frontend/node_modules/next/dist/bin/next'
    if not node or not next_cli.exists() or not (root / 'frontend/.next/BUILD_ID').exists():
        raise SystemExit('Run python3.11 install.py before starting CRAFT.')
    for label, port in [('API', api_port), ('web interface', web_port)]:
        with socket.socket() as check:
            check.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                check.bind((host, port))
            except OSError:
                raise SystemExit(f'Port {port} for the {label} is already in use. Stop the existing instance before starting CRAFT.')
    print(f'Open http://{host}:{web_port}', flush=True)
    processes = []
    stop_requested = False

    def request_stop(signum, frame):
        nonlocal stop_requested
        stop_requested = True

    # Keep repeated interrupts from aborting cleanup; children receive one SIGTERM.
    handled_signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, 'SIGHUP'):
        handled_signals.append(signal.SIGHUP)
    previous_handlers = {sig: signal.signal(sig, request_stop) for sig in handled_signals}
    try:
        processes.append(subprocess.Popen([
            sys.executable, '-m', 'uvicorn', 'main:app', '--host', host,
            '--port', str(api_port), '--ws-max-size', str(32 * 1024 * 1024),
            '--timeout-graceful-shutdown', '5',
        ], cwd=root / 'backend', start_new_session=True))
        if not stop_requested:
            processes.append(subprocess.Popen([
                node, str(next_cli), 'start', '--hostname', host, '--port', str(web_port),
            ], cwd=root / 'frontend', start_new_session=True))
        while not stop_requested and all(process.poll() is None for process in processes):
            time.sleep(0.25)
        if not stop_requested:
            return next((p.returncode for p in processes if p.returncode), 1)
        return 0
    finally:
        try:
            stop_processes(processes)
        finally:
            for sig, handler in previous_handlers.items():
                signal.signal(sig, handler)


if __name__ == '__main__':
    raise SystemExit(main())
