"""Free Microsoft Edge neural TTS (needs internet). usage: tts_edge.py text.txt out.mp3 voice [rate] [pitch]
rate like "+0%" / "-10%", pitch like "+0Hz"."""
import asyncio, os, sys
import edge_tts

txt, out, voice = sys.argv[1], sys.argv[2], sys.argv[3]
rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"
pitch = sys.argv[5] if len(sys.argv) > 5 else "+0Hz"
text = open(txt, encoding="utf-8").read().strip()
proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or None


async def main():
    await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, proxy=proxy).save(out)


asyncio.run(main())
print("wrote", out, flush=True)
