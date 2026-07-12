from scripts.phase10_load_test import percentile


def test_percentile_uses_nearest_rank_in_sorted_samples() -> None:
    samples = [1.0, 2.0, 3.0, 4.0, 5.0]

    assert percentile(samples, 0.50) == 3.0
    assert percentile(samples, 0.95) == 5.0
    assert percentile(samples, 0.99) == 5.0
