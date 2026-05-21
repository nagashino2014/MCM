import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.ieps.annual_report_parser import (  # noqa: E402
    LABEL_BUSINESS_NAME,
    LABEL_INDUSTRY,
    _collect_after_label,
    _parse_scale,
    _split_name_and_brn,
)
from app.ieps.integrated_permit_industries import (  # noqa: E402
    match_integrated_permit_industries,
)


def test_collects_same_line_label_value():
    text = "사업장 명칭 폐제이앤텍 (137-81-25559)\n사업장 소재지 경기도 평택시"

    hit = _collect_after_label(text, LABEL_BUSINESS_NAME)

    assert hit is not None
    assert hit[1] == "폐제이앤텍 (137-81-25559)"
    assert _split_name_and_brn(hit[1]) == ("폐제이앤텍", "137-81-25559")


def test_collects_long_industry_same_line_until_next_label():
    text = (
        "업종명 기타 기초 무기화학 물질 제조업 석유화학계 기초 화학 물질 제조업\n"
        "종 규모\n"
        "[ ] √ 대기 종 1"
    )

    hit = _collect_after_label(text, LABEL_INDUSTRY)

    assert hit is not None
    assert "기타 기초 무기화학 물질 제조업" in hit[1]
    assert "종 규모" not in hit[1]


def test_parse_scale_checked_box_with_reversed_order():
    scale = _parse_scale(
        "[ ] √ 대기 종 1 [ ] 대기 종 2\n"
        "먼지 170.54톤/년, SOx 0.02톤/년, NOx 8.46톤/년\n"
        "[ ] 수질 1종 [ ] √ 수질 종 2 [ ] 수질3종 (폐수배출량 : 0㎥/일)"
    )

    assert scale["air_class"] == 1
    assert scale["water_class"] == 2
    assert scale["dust_ton_per_year"] == 170.54
    assert scale["sox_ton_per_year"] == 0.02
    assert scale["nox_ton_per_year"] == 8.46
    assert scale["wastewater_m3_per_day"] == 0


def test_parse_scale_does_not_select_empty_checkbox_option():
    scale = _parse_scale("[ ] 수질 1종 [ ] 수질 2종 [ ] 수질3종 (폐수배출량 : 0㎥/일)")

    assert "water_class" not in scale
    assert scale["wastewater_m3_per_day"] == 0


def test_integrated_target_industry_matches_short_steam_name():
    matches = match_integrated_permit_industries("증기")

    assert any(item["code"] == "35300" for item in matches)


def test_integrated_target_industry_matches_prefix_scope():
    matches = match_integrated_permit_industries("1차 철강 제조업")

    assert any(item.get("prefixCode") == "241" for item in matches)
