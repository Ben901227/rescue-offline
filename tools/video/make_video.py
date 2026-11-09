"""產生教學影片（直式 1080x1920，給長輩用手機看）。

需要：macOS（say 中文語音 Meijia）、Google Chrome、ffmpeg（PATH 或 FFMPEG 環境變數）。
用法：python3 tools/video/make_video.py [輸出.mp4]
旁白與字幕改 tools/video/script.json；手機示意圖取自 guide.html。
"""
import functools, http.server, json, os, pathlib, subprocess, sys, tempfile, threading

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
VOICE, RATE = 'Meijia', '150'  # ponytail: 語速 150 字/分，長輩覺得太快再調低
PAUSE = 1.0  # 每句說完停幾秒


def run(*cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main(out):
    script = json.loads((ROOT / 'tools/video/script.json').read_text())
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    tmp = pathlib.Path(tempfile.mkdtemp())
    with tempfile.TemporaryDirectory() as profile:
        for i, line in enumerate(script):
            print(f'{i + 1}/{len(script)} {line["text"]}')
            run(CHROME, '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1',
                f'--user-data-dir={profile}', '--window-size=1080,1920', '--virtual-time-budget=5000',
                f'--screenshot={tmp}/{i}.png', f'http://127.0.0.1:{port}/tools/video/frame.html?i={i}')
            run('say', '-v', VOICE, '-r', RATE, '-o', f'{tmp}/{i}.aiff', line.get('say', line['text']))
            run(FFMPEG, '-y', '-loop', '1', '-framerate', '30', '-i', f'{tmp}/{i}.png', '-i', f'{tmp}/{i}.aiff',
                '-af', f'apad=pad_dur={PAUSE}', '-shortest', '-c:v', 'libx264', '-tune', 'stillimage',
                '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-b:a', '128k', f'{tmp}/{i}.mp4')
    server.shutdown()
    (tmp / 'list.txt').write_text(''.join(f"file '{i}.mp4'\n" for i in range(len(script))))
    run(FFMPEG, '-y', '-f', 'concat', '-safe', '0', '-i', f'{tmp}/list.txt', '-c', 'copy',
        '-movflags', '+faststart', str(pathlib.Path(out).resolve()))
    print('完成：', out)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tutorial.mp4')
