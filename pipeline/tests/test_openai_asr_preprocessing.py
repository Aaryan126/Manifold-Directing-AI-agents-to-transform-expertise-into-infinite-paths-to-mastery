from app.asr.base import Transcript, TranscriptWord
from app.asr.openai_provider import _merge_transcripts, _offset_transcript


def test_offset_transcript_shifts_word_timestamps() -> None:
    transcript = Transcript(
        text="second chunk",
        words=(TranscriptWord(text="second", start_seconds=0.2, end_seconds=0.7),),
    )

    shifted = _offset_transcript(transcript, 120.0)

    assert shifted.words[0].start_seconds == 120.2
    assert shifted.words[0].end_seconds == 120.7


def test_merge_transcripts_preserves_word_order_and_text() -> None:
    first = Transcript(
        text="hello",
        words=(TranscriptWord(text="hello", start_seconds=0.0, end_seconds=0.5),),
    )
    second = Transcript(
        text="world",
        words=(TranscriptWord(text="world", start_seconds=0.6, end_seconds=1.0),),
    )

    merged = _merge_transcripts([first, second])

    assert merged.text == "hello world"
    assert [word.text for word in merged.words] == ["hello", "world"]
