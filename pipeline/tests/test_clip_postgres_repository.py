from app.clips.postgres_repository import _slice_transcript_for_topic


def test_clip_context_uses_only_words_inside_the_topic_range() -> None:
    transcript = {
        "text": "first topic second topic final words",
        "words": [
            {"text": "first", "start_seconds": 0.0, "end_seconds": 1.0},
            {"text": "topic", "start_seconds": 1.0, "end_seconds": 2.0},
            {"text": "second", "start_seconds": 10.0, "end_seconds": 11.0},
            {"text": "topic", "start_seconds": 11.0, "end_seconds": 12.0},
            {"text": "final", "start_seconds": 20.0, "end_seconds": 21.0},
            {"text": "words", "start_seconds": 21.0, "end_seconds": 22.0},
        ],
    }

    text, words = _slice_transcript_for_topic(transcript, 9.0, 13.0)

    assert text == "second topic"
    assert [word.text for word in words] == ["second", "topic"]


def test_clip_context_falls_back_when_legacy_transcript_has_no_word_timestamps() -> None:
    transcript = {"text": "Legacy transcript without timestamped words."}

    text, words = _slice_transcript_for_topic(transcript, 0.0, 60.0)

    assert text == transcript["text"]
    assert words == ()
