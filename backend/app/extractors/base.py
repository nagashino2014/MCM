"""
텍스트 추출 기본 클래스 및 결과 타입 정의
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Tuple
from enum import Enum
from datetime import datetime
import re


# ============================================================================
# 인코딩 오류 감지 및 복구 유틸리티
# ============================================================================

# CJK 유니코드 범위 (잘못된 인코딩으로 자주 나타나는 범위)
CJK_UNIFIED_IDEOGRAPHS = (0x4E00, 0x9FFF)
CJK_EXTENSION_A = (0x3400, 0x4DBF)

# UTF-16 LE 바이트 스왑으로 생성되는 대표적인 한자 패턴
# 영문 ASCII가 UTF-16 LE로 인코딩 후 UTF-8로 잘못 해석되면 이런 패턴 발생
UTF16_MISENCODING_PATTERNS = re.compile(
    r'[\u6364\u7365\u6C64\u636F\u6F20\u7462\u6773\u6120'  # 영문 조합
    r'\u7265\u6173\u6F6E\u696E\u676C\u6569\u7374\u6572'  # reason, single, ster
    r'\u6162\u6364\u6566\u6768\u696A\u6B6C\u6D6E\u6F70'  # abcdefghijklmnop (조합)
    r'\u7172\u7374\u7576\u7778\u797A]+'  # qrstuvwxyz (조합)
)

# 연속된 CJK 문자 중 의미 없는 패턴 (영문이 변환된 것)
NONSENSE_CJK_PATTERN = re.compile(r'[\u4E00-\u9FFF]{3,}')

# ============================================================================
# HWP 공백 관련 인코딩 오류 문자 패턴
# ============================================================================
# HWP/HWPX 파일에서 공백(0x20) 바이트가 포함된 인코딩 오류로 발생하는 한자들
# 예: 漠(0x6F20) = 'o'(0x6F) + 공백(0x20), 氠(0x6C20) = 'l'(0x6C) + 공백(0x20)

# 공백(0x20)이 포함된 바이트 조합으로 생성되는 대표적인 쓰레기 한자
# 0xXX20 형태: ASCII문자 + 공백이 UTF-16 LE로 잘못 해석된 경우
HWP_SPACE_GARBAGE_CHARS = {
    '\u2000',  # EN QUAD (공백 변형)
    '\u2001',  # EM QUAD
    '\u2002',  # EN SPACE
    '\u2003',  # EM SPACE
    '\u2004',  # THREE-PER-EM SPACE
    '\u2005',  # FOUR-PER-EM SPACE
    '\u2006',  # SIX-PER-EM SPACE
    '\u2007',  # FIGURE SPACE
    '\u2008',  # PUNCTUATION SPACE
    '\u2009',  # THIN SPACE
    '\u200A',  # HAIR SPACE
    '\u200B',  # ZERO WIDTH SPACE
    '\u200C',  # ZERO WIDTH NON-JOINER
    '\u200D',  # ZERO WIDTH JOINER
    '\u202F',  # NARROW NO-BREAK SPACE
    '\u205F',  # MEDIUM MATHEMATICAL SPACE
    '\u3000',  # IDEOGRAPHIC SPACE
    # 공백(0x20)이 하위 바이트로 포함된 CJK 한자들 (0xXX20 형태)
    '\u4120',  # 'A' + 공백
    '\u4220',  # 'B' + 공백
    '\u4320',  # 'C' + 공백
    '\u4420',  # 'D' + 공백
    '\u4520',  # 'E' + 공백
    '\u4620',  # 'F' + 공백
    '\u4720',  # 'G' + 공백
    '\u4820',  # 'H' + 공백
    '\u4920',  # 'I' + 공백
    '\u4A20',  # 'J' + 공백
    '\u4B20',  # 'K' + 공백
    '\u4C20',  # 'L' + 공백
    '\u4D20',  # 'M' + 공백
    '\u4E20',  # 'N' + 공백 (但)
    '\u4F20',  # 'O' + 공백 (传)
    '\u5020',  # 'P' + 공백 (倠)
    '\u5120',  # 'Q' + 공백 (儠)
    '\u5220',  # 'R' + 공백 (刢)
    '\u5320',  # 'S' + 공백 (匠)
    '\u5420',  # 'T' + 공백 (吠)
    '\u5520',  # 'U' + 공백 (唠)
    '\u5620',  # 'V' + 공백 (嘠)
    '\u5720',  # 'W' + 공백 (圠)
    '\u5820',  # 'X' + 공백 (堠)
    '\u5920',  # 'Y' + 공백 (夠)
    '\u5A20',  # 'Z' + 공백 (娠)
    '\u6120',  # 'a' + 공백 (愠)
    '\u6220',  # 'b' + 공백 (戠)
    '\u6320',  # 'c' + 공백 (挠)
    '\u6420',  # 'd' + 공백 (搠)
    '\u6520',  # 'e' + 공백 (攠)
    '\u6620',  # 'f' + 공백 (映)
    '\u6720',  # 'g' + 공백 (朠)
    '\u6820',  # 'h' + 공백 (栠)
    '\u6920',  # 'i' + 공백 (椠)
    '\u6A20',  # 'j' + 공백 (樠)
    '\u6B20',  # 'k' + 공백 (欠)
    '\u6C20',  # 'l' + 공백 (氠) ← 사용자가 언급한 문자
    '\u6D20',  # 'm' + 공백 (洠)
    '\u6E20',  # 'n' + 공백 (渠)
    '\u6F20',  # 'o' + 공백 (漠) ← 사용자가 언급한 문자
    '\u7020',  # 'p' + 공백 (瀠)
    '\u7120',  # 'q' + 공백 (焠)
    '\u7220',  # 'r' + 공백 (爠)
    '\u7320',  # 's' + 공백 (猠)
    '\u7420',  # 't' + 공백 (琠)
    '\u7520',  # 'u' + 공백 (甠)
    '\u7620',  # 'v' + 공백 (瘠)
    '\u7720',  # 'w' + 공백 (眠)
    '\u7820',  # 'x' + 공백 (砠)
    '\u7920',  # 'y' + 공백 (礠)
    '\u7A20',  # 'z' + 공백 (穠)
    # 숫자 + 공백 조합
    '\u3020',  # '0' + 공백
    '\u3120',  # '1' + 공백
    '\u3220',  # '2' + 공백
    '\u3320',  # '3' + 공백
    '\u3420',  # '4' + 공백
    '\u3520',  # '5' + 공백
    '\u3620',  # '6' + 공백
    '\u3720',  # '7' + 공백
    '\u3820',  # '8' + 공백
    '\u3920',  # '9' + 공백
    # 추가로 발견된 HWP 특유 쓰레기 한자들
    '\u6773',  # 杳 ← 사용자가 언급한 문자
    '\u7462',  # 瑢 ← 사용자가 언급한 문자
    '\u7442',  # 瑂
    '\u6F62',  # 潢
    '\u7367',  # 獧
    '\u6574',  # 整
    '\u6C6F',  # 汯
    '\u6F70',  # 潰
    '\u7369',  # 獩
    '\u7469',  # 瑩
    '\u2074',  # 슈퍼스크립트 4
    '\u2075',  # 슈퍼스크립트 5
    # 추가 인코딩 오류 문자 (2026.01.28)
    '\u6E70',  # 湰 ← 'n'(0x6E) + 'p'(0x70) 조합
    '\u7067',  # 灧 ← 'p'(0x70) + 'g'(0x67) 조합
    '\u706E',  # 灮 ← 'p'(0x70) + 'n'(0x6E) 조합
    '\u6770',  # 杰 ← 'g'(0x67) + 'p'(0x70) 조합
}

# HWP 특유 쓰레기 문자 패턴 (연속으로 나타나는 경우)
HWP_GARBAGE_SEQUENCES = [
    '漠杳',   # 사용자가 언급한 패턴
    '氠瑢',   # 사용자가 언급한 패턴
    '漠瑢',   # 변형 패턴
    '氠杳',   # 변형 패턴
    '愠瑢',   # a + 공백 조합
    '攠瑢',   # e + 공백 조합
    '椠瑢',   # i + 공백 조합
    '渠瑢',   # n + 공백 조합
    '猠瑢',   # s + 공백 조합
    '琠瑢',   # t + 공백 조합
    '湰灧',   # 사용자가 언급한 패턴 (2026.01.28) - 'np' + 'pg' 조합
    '灧湰',   # 변형 패턴
]


def detect_and_remove_hwp_space_garbage(text: str) -> Tuple[str, int, List[str]]:
    """
    HWP/HWPX 파일에서 공백 바이트 관련 인코딩 오류로 발생하는 쓰레기 문자를 감지하고 제거합니다.
    
    이 함수는 특히 다음 패턴을 처리합니다:
    1. 공백(0x20) 바이트가 포함된 한자: 漠(0x6F20), 氠(0x6C20) 등
    2. HWP 문서에서 자주 발생하는 쓰레기 한자 시퀀스: 漠杳, 氠瑢 등
    3. 한글 문맥에서 갑자기 나타나는 의미 없는 CJK 문자들
    
    Args:
        text: 검사할 텍스트
        
    Returns:
        Tuple[str, int, List[str]]: (정리된 텍스트, 제거된 문자 수, 제거된 패턴 목록)
    """
    if not text:
        return text, 0, []
    
    removed_count = 0
    removed_patterns = []
    result = text
    
    # 1. 알려진 쓰레기 시퀀스 패턴 직접 제거
    for seq in HWP_GARBAGE_SEQUENCES:
        if seq in result:
            count = result.count(seq)
            removed_count += count * len(seq)
            removed_patterns.append(f"시퀀스 '{seq}' x{count}")
            result = result.replace(seq, ' ')  # 공백으로 대체 (문장 흐름 유지)
    
    # 2. 개별 쓰레기 문자 제거
    chars_to_remove = []
    for char in HWP_SPACE_GARBAGE_CHARS:
        if char in result:
            count = result.count(char)
            removed_count += count
            chars_to_remove.append(char)
    
    if chars_to_remove:
        removed_patterns.append(f"개별 문자 {len(chars_to_remove)}종 제거")
        for char in chars_to_remove:
            # 공백 계열 문자는 일반 공백으로 대체
            if ord(char) < 0x3000:
                result = result.replace(char, ' ')
            else:
                result = result.replace(char, '')
    
    # 3. 휴리스틱: 한글 문맥에서 갑자기 나타나는 단일/이중 CJK 한자 감지
    # 0xXX20 형태의 코드포인트를 가진 한자 (공백 바이트 포함)
    space_garbage_pattern = re.compile(
        r'[\u4020-\u7A20]'  # 0x4020 ~ 0x7A20 범위 (ASCII + 공백 조합)
    )
    
    # 한글 컨텍스트 패턴
    korean_context = re.compile(r'[\uAC00-\uD7A3]')
    
    def should_remove_cjk_char(match, text, start, end):
        """CJK 문자가 제거 대상인지 판단"""
        char = match.group()
        code = ord(char)
        
        # 0xXX20 형태 (공백이 하위 바이트)인 경우 높은 확률로 쓰레기
        if (code & 0x00FF) == 0x20:
            # 주변 컨텍스트 확인
            context_before = text[max(0, start-5):start]
            context_after = text[end:min(len(text), end+5)]
            
            # 한글 컨텍스트에서 나타나면 확실히 쓰레기
            if korean_context.search(context_before) or korean_context.search(context_after):
                return True
            
            # 컨텍스트가 없어도 0xXX20 패턴은 의심스러움
            # 연속된 일반 CJK 문맥이 아니면 제거
            if not (0x4E00 <= code <= 0x9FFF):
                return True
        
        return False
    
    # 정규식으로 잠재적 쓰레기 문자 찾아서 처리
    new_result = []
    last_end = 0
    additional_removed = 0
    
    for match in space_garbage_pattern.finditer(result):
        start, end = match.start(), match.end()
        
        if should_remove_cjk_char(match, result, start, end):
            new_result.append(result[last_end:start])
            new_result.append(' ')  # 공백으로 대체
            additional_removed += 1
            last_end = end
    
    new_result.append(result[last_end:])
    result = ''.join(new_result)
    
    if additional_removed > 0:
        removed_count += additional_removed
        removed_patterns.append(f"휴리스틱 감지 {additional_removed}자")
    
    # 4. 정리: 연속 공백 제거 및 트리밍
    result = re.sub(r' {2,}', ' ', result)
    result = re.sub(r'\n{3,}', '\n\n', result)
    result = re.sub(r'^ +| +$', '', result, flags=re.MULTILINE)
    
    return result.strip(), removed_count, removed_patterns


def detect_utf16_misencoding(text: str) -> bool:
    """
    UTF-16 잘못된 인코딩으로 인한 비정상 텍스트 감지
    
    매우 심각한 인코딩 오류만 감지 (보수적 접근):
    1. UTF-16 바이트 분리: 영문/숫자가 두 번씩 반복됨 (AABBCC, 112233 등)
    2. 깨진 문자가 대량으로 포함된 경우
    
    Args:
        text: 검사할 텍스트
        
    Returns:
        bool: 심각한 UTF-16 인코딩 오류가 확실한 경우에만 True
    """
    if not text or len(text) < 100:
        return False
    
    text_no_space = re.sub(r'\s', '', text)
    if not text_no_space:
        return False
    
    total_chars = len(text_no_space)
    
    # 1. 심각한 UTF-16 바이트 분리 패턴 (연속된 이중 문자)
    # 예: AABBCCDD, 11223344 등 (4쌍 이상 연속, 8자리)
    # 패턴을 더 엄격하게 변경
    severe_double_pattern = re.compile(
        r'([A-Z])\1([A-Z])\2([A-Z])\3([A-Z])\4|'  # AABBCCDD
        r'([0-9])\5([0-9])\6([0-9])\7([0-9])\8'   # 11223344
    )
    double_matches = severe_double_pattern.findall(text)
    # 이 패턴이 텍스트 전체에서 여러 번 발생해야 인코딩 오류로 판단
    if len(double_matches) >= 5:
        print(f"[ENCODING CHECK] 이중 반복 패턴 감지: {len(double_matches)}회")
        return True
    
    # 2. 깨진 제어 문자 비율 (NULL, BOM 등) - 더 엄격하게
    broken_chars = sum(1 for c in text if ord(c) < 0x20 and c not in '\n\r\t')
    broken_chars += sum(1 for c in text if ord(c) in [0xFFFD, 0xFFFE, 0xFFFF])
    broken_ratio = broken_chars / len(text)
    
    if broken_ratio > 0.10:  # 10% 이상 깨진 문자로 상향
        print(f"[ENCODING CHECK] 깨진 문자 비율: {broken_ratio:.1%}")
        return True
    
    # 3. 한글이 전혀 없고 PUA 문자 비율이 매우 높은 경우
    korean_chars = len(re.findall(r'[가-힣]', text))
    korean_ratio = korean_chars / total_chars
    
    pua_chars = sum(1 for c in text_no_space if 0xE000 <= ord(c) <= 0xF8FF)
    pua_ratio = pua_chars / total_chars
    
    # 한글이 거의 없고 PUA가 30% 이상이면 인코딩 오류 (상향)
    if korean_ratio < 0.01 and pua_ratio > 0.3:
        print(f"[ENCODING CHECK] PUA 비율 높음: {pua_ratio:.1%}, 한글: {korean_ratio:.1%}")
        return True
    
    # 4. 조건 제거 - 일반적인 이중 반복은 정상 텍스트에서도 흔함
    # (예: "good", "book", "1000" 등)
    # 이 조건이 오탐의 주요 원인이었음
    
    return False


def try_fix_utf16_misencoding(text: str) -> Tuple[str, bool]:
    """
    UTF-16 인코딩 오류 복구 시도
    
    잘못 해석된 텍스트를 원래 인코딩으로 복구합니다.
    
    Args:
        text: 복구할 텍스트
        
    Returns:
        Tuple[str, bool]: (복구된 텍스트, 복구 성공 여부)
    """
    if not detect_utf16_misencoding(text):
        return text, False
    
    try:
        # UTF-8로 인코딩된 것을 Latin-1로 다시 읽고 UTF-16 LE로 디코딩 시도
        # 이렇게 하면 바이트 스왑된 데이터를 복구할 수 있음
        
        # 방법 1: UTF-8 → bytes → UTF-16 LE
        try:
            raw_bytes = text.encode('utf-8')
            # 짝수 바이트인지 확인
            if len(raw_bytes) % 2 == 0:
                # 바이트 스왑 시도
                swapped = bytes([raw_bytes[i+1] if i+1 < len(raw_bytes) else raw_bytes[i] 
                               for i in range(0, len(raw_bytes), 2) 
                               for j in (1, 0)])[:len(raw_bytes)]
                
                # 스왑된 바이트를 UTF-8로 디코딩
                decoded = swapped.decode('utf-8', errors='ignore')
                
                # 결과 검증: ASCII 비율이 높으면 성공
                ascii_count = sum(1 for c in decoded if ord(c) < 128 and c.isprintable())
                if len(decoded) > 0 and ascii_count / len(decoded) > 0.5:
                    return decoded, True
        except:
            pass
        
        # 방법 2: 직접 바이트 스왑
        result = []
        i = 0
        while i < len(text):
            char = text[i]
            code = ord(char)
            
            # CJK 범위의 문자를 ASCII 2바이트로 분해
            if CJK_UNIFIED_IDEOGRAPHS[0] <= code <= CJK_UNIFIED_IDEOGRAPHS[1]:
                # UTF-16 LE에서 상위/하위 바이트 추출
                high = (code >> 8) & 0xFF
                low = code & 0xFF
                
                # ASCII 범위인지 확인
                if 0x20 <= high < 0x7F and 0x20 <= low < 0x7F:
                    # 바이트 순서 복원 (LE → 원래 순서)
                    result.append(chr(low))
                    result.append(chr(high))
                else:
                    result.append(char)
            else:
                result.append(char)
            
            i += 1
        
        fixed = ''.join(result)
        
        # 결과 검증
        if fixed != text:
            # ASCII/한글 비율 확인
            ascii_korean = sum(1 for c in fixed if ord(c) < 128 or 0xAC00 <= ord(c) <= 0xD7A3)
            if len(fixed) > 0 and ascii_korean / len(fixed) > 0.5:
                return fixed, True
        
    except Exception as e:
        print(f"[ENCODING FIX] Error: {e}")
    
    return text, False


def fix_jieut_to_zero(text: str) -> Tuple[str, int]:
    """
    HWP 파일에서 숫자 0이 한글 자모 'ㅇ'(U+3147)으로 저장된 경우 수정
    
    HWP에서 특정 폰트/스타일을 사용할 때 숫자 0이 내부적으로 'ㅇ'으로
    저장되지만 화면에는 '0'으로 표시되는 경우가 있음.
    이 함수는 숫자 문맥에서 'ㅇ'을 '0'으로 변환함.
    
    변환 대상 패턴:
    - 숫자 + ㅇ + 숫자/단위: "1ㅇ번" → "10번", "2ㅇ25년" → "2025년"
    - 숫자 + ㅇ + 끝: "1ㅇ" → "10" (문장 끝이나 공백 앞)
    - 숫자 + ㅇㅇ + 숫자/단위: "1ㅇㅇ개" → "100개", "2ㅇㅇㅇ원" → "2000원"
    
    Args:
        text: 변환할 텍스트
        
    Returns:
        Tuple[str, int]: (변환된 텍스트, 변환된 횟수)
    """
    if not text:
        return text, 0
    
    count = 0
    result = text
    
    # 패턴 1: 숫자 + ㅇ (1개 이상) + 숫자
    # 예: 1ㅇ5 → 105, 2ㅇㅇ5 → 2005
    pattern1 = re.compile(r'(\d)(ㅇ+)(\d)')
    def replace1(m):
        nonlocal count
        zeros = '0' * len(m.group(2))
        count += len(m.group(2))
        return m.group(1) + zeros + m.group(3)
    result = pattern1.sub(replace1, result)
    
    # 패턴 2: 숫자 + ㅇ (1개 이상) + 단위/조사
    # 예: 1ㅇ번 → 10번, 2ㅇㅇ원 → 200원, 1ㅇ월 → 10월
    units = r'(?:번|월|일|년|시|분|초|개|명|회|차|호|층|점|위|%|원|달러|엔|위안|' \
            r'억|만|천|백|십|조|경|m|km|cm|mm|kg|g|mg|L|mL|㎡|㎢|ha|' \
            r'포|장|대|건|곳|권|편|종|세트|박스|케이스|팩)'
    pattern2 = re.compile(rf'(\d)(ㅇ+)({units})')
    def replace2(m):
        nonlocal count
        zeros = '0' * len(m.group(2))
        count += len(m.group(2))
        return m.group(1) + zeros + m.group(3)
    result = pattern2.sub(replace2, result)
    
    # 패턴 3: 숫자 + ㅇ (1개 이상) + 공백/줄바꿈/문장부호
    # 예: "총 1ㅇ " → "총 10 ", "약 1ㅇㅇ." → "약 100."
    pattern3 = re.compile(r'(\d)(ㅇ+)([\s\.\,\!\?\)\]\}]|$)')
    def replace3(m):
        nonlocal count
        zeros = '0' * len(m.group(2))
        count += len(m.group(2))
        return m.group(1) + zeros + m.group(3)
    result = pattern3.sub(replace3, result)
    
    # 패턴 4: 소수점 뒤 숫자 + ㅇ
    # 예: 3.1ㅇ → 3.10, 0.ㅇ5 → 0.05
    pattern4 = re.compile(r'(\.\d*)(ㅇ+)(\d*)')
    def replace4(m):
        nonlocal count
        zeros = '0' * len(m.group(2))
        count += len(m.group(2))
        return m.group(1) + zeros + m.group(3)
    result = pattern4.sub(replace4, result)
    
    # 패턴 5: 시작 부분 ㅇ + 숫자 (드문 케이스)
    # 예: ㅇ5시 → 05시
    pattern5 = re.compile(r'(^|\s)(ㅇ+)(\d)')
    def replace5(m):
        nonlocal count
        zeros = '0' * len(m.group(2))
        count += len(m.group(2))
        return m.group(1) + zeros + m.group(3)
    result = pattern5.sub(replace5, result)
    
    if count > 0:
        print(f"[TEXT FIX] ㅇ → 0 변환: {count}회")
    
    return result, count


def clean_binary_garbage(text: str) -> str:
    """
    텍스트에 혼입된 바이너리 쓰레기 문자 제거
    
    Args:
        text: 정리할 텍스트
        
    Returns:
        str: 정리된 텍스트
    """
    if not text:
        return text
    
    # 제어 문자 제거 (줄바꿈, 탭 제외)
    cleaned = []
    for char in text:
        code = ord(char)
        # 유지할 문자: 줄바꿈, 탭, 일반 출력 가능 문자
        if code == 0x0A or code == 0x0D or code == 0x09:
            cleaned.append(char)
        elif code >= 0x20:
            # Private Use Area 제외
            if not (0xE000 <= code <= 0xF8FF):
                cleaned.append(char)
    
    return ''.join(cleaned)


def detect_and_remove_utf16le_garbage(text: str) -> Tuple[str, int]:
    """
    UTF-16 LE 인코딩된 영문 텍스트를 UTF-8로 잘못 해석할 때 발생하는
    한자/특수 문자를 감지하고 제거합니다.
    
    이 현상은 UTF-16 LE에서 ASCII 문자(예: 'de') 2바이트가 
    UTF-8로 잘못 해석되어 CJK 유니코드 문자로 변환될 때 발생합니다.
    예: 'd'(0x64) + 'e'(0x65) → UTF-16 LE로 0x6564 → '敤'
    
    감지 기준:
    1. CJK Unified Ideographs 범위(0x4E00-0x9FFF)의 문자가 연속으로 나타남
    2. 해당 문자들이 의미있는 한자 문장이 아닌 무작위 패턴
    3. 한국어 문서에서 비정상적으로 많은 한자 비율
    
    Args:
        text: 검사할 텍스트
        
    Returns:
        Tuple[str, int]: (정리된 텍스트, 제거된 문자 수)
    """
    if not text:
        return text, 0
    
    # UTF-16 LE 오인식으로 발생하는 대표적인 패턴들
    # 이들은 ASCII 문자 조합이 UTF-16 LE → UTF-8 오인식으로 생성됨
    UTF16LE_GARBAGE_PATTERNS = [
        # 'desldocl bt osg' 등 영문이 변환된 패턴
        '捤獥汤捯氠瑢漠杳',      # 'desldocl bt osg' 변환 예시
        '敤汳潤汣',              # 'desldocl' 일부
        '扴漠杳',               # 'bt osg' 일부
        '潤汣',                 # 'docl' 변환
        '汤捯',                 # 'ldoc' 변환
    ]
    
    removed_count = 0
    result = text
    
    # 1. 알려진 쓰레기 패턴 직접 제거
    for pattern in UTF16LE_GARBAGE_PATTERNS:
        if pattern in result:
            removed_count += result.count(pattern) * len(pattern)
            result = result.replace(pattern, '')
    
    # 2. 휴리스틱 기반 쓰레기 한자 감지 및 제거
    # 연속된 CJK 한자가 3개 이상이고, 주변에 한글이 없으면 쓰레기로 간주
    import re
    
    # CJK Unified Ideographs만 포함된 연속 문자열 감지 (3자 이상)
    cjk_pattern = re.compile(r'[\u4E00-\u9FFF]{3,}')
    
    # 한글 음절 패턴
    korean_pattern = re.compile(r'[\uAC00-\uD7A3]')
    
    def is_garbage_cjk_sequence(match_text: str, context_before: str, context_after: str) -> bool:
        """CJK 시퀀스가 쓰레기인지 판단"""
        # 주변 20자 컨텍스트에서 한글이 있는지 확인
        context = context_before[-20:] + context_after[:20]
        korean_in_context = korean_pattern.search(context)
        
        # 한글 컨텍스트가 있으면서 한자가 연속으로 나오면 쓰레기일 가능성 높음
        # (일반적인 한국어 문서에서 한자는 드물게 단독으로 사용됨)
        if korean_in_context:
            # 한자 시퀀스가 5자 이상이면 거의 확실히 쓰레기
            if len(match_text) >= 5:
                return True
            # 3-4자인 경우, 특정 패턴 확인
            # 예: 연속된 한자가 실제 단어가 아닌지 확인 (간단한 휴리스틱)
            # UTF-16 LE 오인식 결과는 대부분 생소한 한자 조합
            if len(match_text) >= 3:
                # 각 문자의 코드포인트 패턴 분석
                codes = [ord(c) for c in match_text]
                # 코드가 매우 산발적으로 분포하면 쓰레기
                code_range = max(codes) - min(codes)
                if code_range > 1000:  # 정상적인 한자 단어는 보통 비슷한 범위
                    return True
        else:
            # 한글 컨텍스트가 없는데 한자만 있으면 쓰레기 가능성
            if len(match_text) >= 4:
                return True
        
        return False
    
    # 정규식으로 CJK 시퀀스 찾아서 처리
    offset = 0
    new_result = []
    last_end = 0
    
    for match in cjk_pattern.finditer(result):
        start, end = match.start(), match.end()
        match_text = match.group()
        
        # 컨텍스트 추출
        context_before = result[max(0, start-20):start]
        context_after = result[end:min(len(result), end+20)]
        
        if is_garbage_cjk_sequence(match_text, context_before, context_after):
            # 쓰레기로 판단되면 제거
            new_result.append(result[last_end:start])
            removed_count += len(match_text)
            last_end = end
        # else: 유지 (정상적인 한자로 판단)
    
    new_result.append(result[last_end:])
    result = ''.join(new_result)
    
    # 3. 연속 공백 정리 (제거 후 생긴 여분 공백)
    result = re.sub(r' {2,}', ' ', result)
    result = re.sub(r'\n{3,}', '\n\n', result)
    
    return result.strip(), removed_count


# ============================================================================
# 강제 인코딩 및 다중 인코딩 시도 함수
# ============================================================================

# 시도할 인코딩 목록 (우선순위 순)
ENCODING_CANDIDATES = [
    'utf-8',
    'euc-kr',
    'cp949',
    'utf-16',
    'utf-16-le',
    'utf-16-be',
    'iso-8859-1',
    'latin-1',
]


def try_decode_with_encoding(raw_bytes: bytes, encoding: str) -> Tuple[str, bool]:
    """
    특정 인코딩으로 바이트 디코딩 시도
    
    Args:
        raw_bytes: 디코딩할 바이트
        encoding: 시도할 인코딩
        
    Returns:
        Tuple[str, bool]: (디코딩 결과, 성공 여부)
    """
    try:
        decoded = raw_bytes.decode(encoding, errors='strict')
        return decoded, True
    except (UnicodeDecodeError, LookupError):
        try:
            # strict 실패 시 replace 모드로 재시도
            decoded = raw_bytes.decode(encoding, errors='replace')
            # 교체된 문자가 너무 많으면 실패로 간주
            if decoded.count('\ufffd') / max(len(decoded), 1) > 0.1:
                return "", False
            return decoded, True
        except:
            return "", False


def detect_encoding(raw_bytes: bytes) -> str:
    """
    바이트의 인코딩 자동 감지
    
    Args:
        raw_bytes: 감지할 바이트
        
    Returns:
        str: 감지된 인코딩 이름
    """
    # BOM 확인
    if raw_bytes.startswith(b'\xff\xfe'):
        return 'utf-16-le'
    if raw_bytes.startswith(b'\xfe\xff'):
        return 'utf-16-be'
    if raw_bytes.startswith(b'\xef\xbb\xbf'):
        return 'utf-8'
    
    # chardet 사용 시도
    try:
        import chardet
        result = chardet.detect(raw_bytes)
        if result and result.get('confidence', 0) > 0.7:
            return result['encoding'] or 'utf-8'
    except ImportError:
        pass
    
    # 휴리스틱 감지
    # EUC-KR/CP949 특성: 0x80-0xFF 범위의 바이트가 연속으로 나타남
    high_bytes = sum(1 for b in raw_bytes if b >= 0x80)
    if high_bytes > len(raw_bytes) * 0.1:
        # 한글이 포함된 것으로 추정
        # UTF-8 시도
        try:
            raw_bytes.decode('utf-8', errors='strict')
            return 'utf-8'
        except:
            # EUC-KR 시도
            try:
                raw_bytes.decode('euc-kr', errors='strict')
                return 'euc-kr'
            except:
                return 'cp949'
    
    return 'utf-8'


def try_multiple_encodings(raw_bytes: bytes, preferred_encodings: List[str] = None) -> Tuple[str, str, bool]:
    """
    여러 인코딩을 시도하여 최적의 결과 반환
    
    Args:
        raw_bytes: 디코딩할 바이트
        preferred_encodings: 우선 시도할 인코딩 목록
        
    Returns:
        Tuple[str, str, bool]: (디코딩 결과, 사용된 인코딩, 성공 여부)
    """
    encodings = preferred_encodings or ENCODING_CANDIDATES
    
    best_result = ""
    best_encoding = ""
    best_score = -1
    
    for encoding in encodings:
        text, success = try_decode_with_encoding(raw_bytes, encoding)
        if success and text:
            # 결과 품질 평가
            score = _evaluate_decoding_quality(text)
            if score > best_score:
                best_score = score
                best_result = text
                best_encoding = encoding
                
                # 품질이 충분히 좋으면 조기 종료
                if score > 0.9:
                    break
    
    return best_result, best_encoding, best_score > 0.5


def _evaluate_decoding_quality(text: str) -> float:
    """디코딩 결과 품질 평가 (0~1)"""
    if not text:
        return 0.0
    
    # 유효 문자 비율
    valid_chars = 0
    korean_chars = 0
    ascii_chars = 0
    
    for char in text:
        code = ord(char)
        if code < 128:
            if char.isprintable() or char in '\n\r\t':
                valid_chars += 1
                ascii_chars += 1
        elif 0xAC00 <= code <= 0xD7A3:  # 한글 음절
            valid_chars += 1
            korean_chars += 1
        elif 0x1100 <= code <= 0x11FF:  # 한글 자모
            valid_chars += 1
            korean_chars += 1
        elif 0x3130 <= code <= 0x318F:  # 호환용 한글 자모
            valid_chars += 1
            korean_chars += 1
        elif code >= 0x20 and not (0xE000 <= code <= 0xF8FF):
            valid_chars += 1
    
    valid_ratio = valid_chars / max(len(text), 1)
    
    # 대체 문자(\ufffd) 비율
    replacement_ratio = text.count('\ufffd') / max(len(text), 1)
    
    # 점수 계산
    score = valid_ratio * 0.6 + (1 - replacement_ratio) * 0.4
    
    return min(max(score, 0.0), 1.0)


def force_encoding_conversion(text: str, source_encoding: str, target_encoding: str = 'utf-8') -> Tuple[str, bool]:
    """
    텍스트의 인코딩 강제 변환
    
    Args:
        text: 변환할 텍스트
        source_encoding: 원본 인코딩 (텍스트가 잘못 해석된 인코딩)
        target_encoding: 목표 인코딩
        
    Returns:
        Tuple[str, bool]: (변환된 텍스트, 성공 여부)
    """
    try:
        # 현재 텍스트를 source_encoding으로 인코딩하여 바이트로 변환
        raw_bytes = text.encode(source_encoding, errors='ignore')
        # 바이트를 target_encoding으로 디코딩
        converted = raw_bytes.decode(target_encoding, errors='replace')
        return converted, True
    except (UnicodeDecodeError, UnicodeEncodeError, LookupError):
        return text, False


def apply_encoding_recovery(text: str, config_encoding: str = "auto", 
                           fix_utf16: bool = True, 
                           remove_broken: bool = True) -> Tuple[str, List[dict]]:
    """
    설정에 따른 인코딩 복구 적용
    
    Args:
        text: 복구할 텍스트
        config_encoding: 인코딩 설정 (auto, utf-8, euc-kr, cp949, utf-16)
        fix_utf16: UTF-16 오류 복구 여부
        remove_broken: 깨진 문자 제거 여부
        
    Returns:
        Tuple[str, List[dict]]: (복구된 텍스트, 적용된 복구 목록)
    """
    corrections = []
    result = text
    
    # 1. 강제 인코딩 지정 처리
    if config_encoding != "auto":
        # 잘못된 인코딩으로 해석된 텍스트를 올바른 인코딩으로 변환 시도
        for source_enc in ['latin-1', 'iso-8859-1', 'cp1252']:
            converted, success = force_encoding_conversion(result, source_enc, config_encoding)
            if success:
                # 변환 후 품질 확인
                if _evaluate_decoding_quality(converted) > _evaluate_decoding_quality(result):
                    result = converted
                    corrections.append({
                        "type": "force_encoding",
                        "source": source_enc,
                        "target": config_encoding,
                    })
                    break
    
    # 2. UTF-16 오류 복구
    if fix_utf16 and detect_utf16_misencoding(result):
        fixed, was_fixed = try_fix_utf16_misencoding(result)
        if was_fixed:
            result = fixed
            corrections.append({
                "type": "utf16_fix",
                "description": "UTF-16 인코딩 오류 복구",
            })
    
    # 3. 깨진 문자 제거
    if remove_broken:
        original_len = len(result)
        result = clean_binary_garbage(result)
        if len(result) < original_len:
            corrections.append({
                "type": "binary_cleanup",
                "removed_chars": original_len - len(result),
            })
    
    # 4. UTF-16 LE 오인식 한자 쓰레기 제거
    result, utf16_garbage_count = detect_and_remove_utf16le_garbage(result)
    if utf16_garbage_count > 0:
        corrections.append({
            "type": "utf16le_garbage_cleanup",
            "description": "UTF-16 LE 오인식 한자 문자 제거",
            "removed_chars": utf16_garbage_count,
        })
    
    return result, corrections


def quick_validate_text_quality(text: str) -> Tuple[bool, float, str]:
    """
    텍스트 품질 빠른 검증 (인코딩 오류 감지용)
    
    Args:
        text: 검증할 텍스트
        
    Returns:
        Tuple[bool, float, str]: (유효 여부, 품질 점수, 오류 사유)
    """
    if not text or len(text.strip()) < 10:
        return False, 0.0, "텍스트가 비어있거나 너무 짧음"
    
    text_no_space = re.sub(r'\s', '', text)
    if not text_no_space:
        return False, 0.0, "공백 외 문자 없음"
    
    # 1. 한글 비율 확인
    korean_chars = len(re.findall(r'[가-힣]', text))
    korean_ratio = korean_chars / len(text_no_space)
    
    # 2. 깨진 문자 비율 확인
    broken_pattern = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd\uFFFE\uFFFF]')
    broken_chars = len(broken_pattern.findall(text))
    broken_ratio = broken_chars / len(text)
    
    # 3. 심각한 영문/숫자 이중 반복 패턴 확인 (인코딩 오류 지표)
    # 4쌍 이상 연속되고, 5회 이상 발생해야 인코딩 오류로 판단
    double_pattern = re.compile(
        r'([A-Z])\1([A-Z])\2([A-Z])\3([A-Z])\4|'  # AABBCCDD
        r'([0-9])\5([0-9])\6([0-9])\7([0-9])\8'   # 11223344
    )
    double_matches = double_pattern.findall(text)
    has_severe_double = len(double_matches) >= 5
    
    # 4. PUA 문자 비율
    pua_chars = sum(1 for c in text if 0xE000 <= ord(c) <= 0xF8FF)
    pua_ratio = pua_chars / len(text_no_space)
    
    # 5. 유효 문자 비율
    valid_chars = sum(1 for c in text if ord(c) >= 0x20 and not (0xE000 <= ord(c) <= 0xF8FF))
    valid_ratio = valid_chars / len(text)
    
    # 품질 점수 계산
    score = 0.0
    error_reason = ""
    
    if has_severe_double:
        score = 0.1
        error_reason = "심각한 인코딩 오류 (이중 반복 패턴)"
    elif broken_ratio > 0.1:
        score = 0.2
        error_reason = f"깨진 문자 비율 높음 ({broken_ratio:.1%})"
    elif pua_ratio > 0.15:
        score = 0.2
        error_reason = f"PUA 문자 비율 높음 ({pua_ratio:.1%})"
    elif korean_ratio < 0.05 and valid_ratio < 0.5:
        score = 0.3
        error_reason = f"유효 문자 비율 낮음 (한글: {korean_ratio:.1%}, 유효: {valid_ratio:.1%})"
    else:
        score = valid_ratio * 0.5 + korean_ratio * 0.3 + (1 - broken_ratio) * 0.2
        if score >= 0.5:
            return True, score, ""
        error_reason = f"전체 품질 낮음 ({score:.1%})"
    
    return False, score, error_reason


def smart_decode_bytes(raw_bytes: bytes, preferred_encoding: str = None) -> Tuple[str, str, List[dict]]:
    """
    바이트를 스마트하게 디코딩 (여러 인코딩 시도 후 최적 결과 반환)
    
    Args:
        raw_bytes: 디코딩할 바이트
        preferred_encoding: 우선 시도할 인코딩
        
    Returns:
        Tuple[str, str, List[dict]]: (디코딩된 텍스트, 사용된 인코딩, 보정 내역)
    """
    corrections = []
    
    # 시도할 인코딩 순서
    encodings_to_try = []
    if preferred_encoding:
        encodings_to_try.append(preferred_encoding)
    encodings_to_try.extend(['utf-8', 'utf-16-le', 'utf-16-be', 'euc-kr', 'cp949', 'latin-1'])
    
    # BOM 확인
    if raw_bytes.startswith(b'\xff\xfe'):
        encodings_to_try.insert(0, 'utf-16-le')
    elif raw_bytes.startswith(b'\xfe\xff'):
        encodings_to_try.insert(0, 'utf-16-be')
    elif raw_bytes.startswith(b'\xef\xbb\xbf'):
        encodings_to_try.insert(0, 'utf-8-sig')
    
    best_text = ""
    best_encoding = ""
    best_score = 0.0
    
    for encoding in encodings_to_try:
        try:
            text = raw_bytes.decode(encoding, errors='replace')
            is_valid, score, _ = quick_validate_text_quality(text)
            
            if score > best_score:
                best_text = text
                best_encoding = encoding
                best_score = score
                
                if is_valid and score >= 0.7:
                    # 충분히 좋은 결과 찾음
                    break
        except:
            continue
    
    if best_encoding:
        corrections.append({
            "type": "encoding_detected",
            "encoding": best_encoding,
            "quality_score": best_score
        })
    else:
        # 모든 인코딩 실패 시 UTF-8 기본값
        best_text = raw_bytes.decode('utf-8', errors='replace')
        best_encoding = 'utf-8'
        corrections.append({
            "type": "encoding_fallback",
            "encoding": "utf-8",
            "reason": "모든 인코딩 시도 실패"
        })
    
    return best_text, best_encoding, corrections


def recover_encoding_with_retry(text: str) -> Tuple[str, List[dict]]:
    """
    인코딩 오류가 있는 텍스트를 여러 방법으로 복구 시도
    
    Args:
        text: 복구할 텍스트
        
    Returns:
        Tuple[str, List[dict]]: (복구된 텍스트, 보정 내역)
    """
    corrections = []
    is_valid, score, error_reason = quick_validate_text_quality(text)
    
    if is_valid and score >= 0.6:
        # 이미 품질이 충분함
        return text, corrections
    
    best_text = text
    best_score = score
    
    # 방법 1: UTF-16 오류 복구
    if detect_utf16_misencoding(text):
        fixed, was_fixed = try_fix_utf16_misencoding(text)
        if was_fixed:
            _, new_score, _ = quick_validate_text_quality(fixed)
            if new_score > best_score:
                best_text = fixed
                best_score = new_score
                corrections.append({
                    "type": "utf16_recovery",
                    "improvement": new_score - score
                })
    
    # 방법 2: 바이트 재해석 (텍스트를 바이트로 변환 후 다른 인코딩으로 디코딩)
    encoding_pairs = [
        ('latin-1', 'utf-8'),
        ('latin-1', 'euc-kr'),
        ('latin-1', 'cp949'),
        ('cp1252', 'utf-8'),
        ('cp1252', 'euc-kr'),
    ]
    
    for source_enc, target_enc in encoding_pairs:
        try:
            # 텍스트를 source_enc로 인코딩하여 바이트로 변환
            raw_bytes = text.encode(source_enc, errors='ignore')
            # 바이트를 target_enc로 디코딩
            recovered = raw_bytes.decode(target_enc, errors='replace')
            
            _, new_score, _ = quick_validate_text_quality(recovered)
            if new_score > best_score + 0.1:  # 최소 10% 향상
                best_text = recovered
                best_score = new_score
                corrections.append({
                    "type": "encoding_reinterpret",
                    "from": source_enc,
                    "to": target_enc,
                    "improvement": new_score - score
                })
        except:
            continue
    
    # 방법 3: 깨진 문자/가비지 제거
    cleaned = clean_binary_garbage(best_text)
    cleaned, garbage_count = detect_and_remove_utf16le_garbage(cleaned)
    
    if garbage_count > 0:
        _, new_score, _ = quick_validate_text_quality(cleaned)
        if new_score >= best_score:
            best_text = cleaned
            best_score = new_score
            corrections.append({
                "type": "garbage_cleanup",
                "removed_chars": garbage_count
            })
    
    return best_text, corrections


class ExtractionMethod(str, Enum):
    """추출 방법"""
    TEXT_LAYER = "text_layer"
    PADDLEOCR = "paddleocr"
    HYBRID = "hybrid"
    EASYOCR = "easyocr"
    TESSERACT = "tesseract"
    LLM = "llm"


class ExtractionStatus(str, Enum):
    """추출 상태"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    LLM_FALLBACK = "llm_fallback"


@dataclass
class TableData:
    """추출된 표 데이터 (RAG 최적화)"""
    table_index: int                           # 페이지 내 표 순번
    rows: List[List[str]]                      # 2D 배열 형태의 표 데이터
    semantic_text: str                         # RAG용 선형화 텍스트 (헤더:값 형태)
    structured_data: Optional[Dict[str, Any]] = None  # JSON 구조화 데이터
    markdown: str = ""                         # 마크다운 (호환성용, 비권장)
    bbox: Optional[Tuple[float, ...]] = None   # 표 위치 (x0, y0, x1, y1)
    row_count: int = 0
    col_count: int = 0
    confidence: float = 0.0                    # 추출 신뢰도
    extraction_method: str = ""                # 추출 방법 (line_detection, pdfplumber 등)
    
    # Cross-page Table Merging 지원 필드
    page_num: int = 0                          # 표가 시작된 페이지 번호
    page_span: Optional[List[int]] = None      # 표가 걸쳐있는 페이지 목록 (예: [1, 2, 3])
    is_merged: bool = False                    # Cross-page 병합된 표 여부
    original_table_indices: Optional[List[int]] = None  # 병합 전 원본 표 인덱스들
    header_signature: str = ""                 # 헤더 시그니처 해시 (병합 식별용)
    merge_confidence: float = 0.0              # 병합 신뢰도 (0.0~1.0)


@dataclass
class PageResult:
    """페이지별 추출 결과"""
    page_num: int
    text: str
    method: ExtractionMethod
    confidence: Optional[float] = None
    has_images: bool = False
    has_tables: bool = False
    tables: List[TableData] = field(default_factory=list)  # 추출된 표 목록


@dataclass
class QualityDetails:
    """품질 검증 상세 정보"""
    # 원시 비율/값
    korean_ratio: float = 0.0
    broken_char_ratio: float = 0.0
    sentence_structure: float = 0.0
    repetition_anomaly: float = 0.0
    encoding_error: bool = False
    
    # 정규화된 점수 (0~1, 높을수록 좋음)
    korean_score: float = 0.0       # 한국어 비율 점수
    broken_score: float = 0.0       # 깨진 문자 점수 (1 - broken_ratio)
    sentence_score: float = 0.0     # 문장 구조 점수
    repetition_score: float = 0.0   # 반복 이상 점수 (1 - anomaly)
    encoding_score: float = 1.0     # 인코딩 오류 점수 (오류 없으면 1)
    
    # 종합 점수
    overall_score: float = 0.0
    
    def to_dict(self) -> dict:
        """프론트엔드 전송용 딕셔너리 변환"""
        return {
            "korean_score": self.korean_score,
            "broken_score": self.broken_score,
            "sentence_score": self.sentence_score,
            "repetition_score": self.repetition_score,
            "encoding_score": self.encoding_score,
            "overall_score": self.overall_score,
        }


@dataclass
class ExtractionResult:
    """텍스트 추출 결과 (RAG 최적화)"""
    # 기본 정보
    file_path: str
    file_format: str
    status: ExtractionStatus
    
    # 추출 결과
    text: str = ""
    pages: List[PageResult] = field(default_factory=list)
    page_count: int = 0
    
    # 구조화된 표 데이터 (RAG DB용)
    structured_tables: List[Dict[str, Any]] = field(default_factory=list)
    
    # 품질 정보
    quality_score: float = 0.0
    quality_details: Optional[QualityDetails] = None
    extraction_method: ExtractionMethod = ExtractionMethod.TEXT_LAYER
    
    # 메타데이터
    char_count: int = 0
    token_count: int = 0
    processing_time_ms: int = 0
    
    # 오류 정보
    error_message: Optional[str] = None
    corrections: List[Dict[str, Any]] = field(default_factory=list)
    
    # 추가 메타데이터 (XLSX 구조화 데이터 등)
    metadata: Optional[Dict[str, Any]] = None
    
    # 타임스탬프
    extracted_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        """딕셔너리로 변환"""
        return {
            "file_path": self.file_path,
            "file_format": self.file_format,
            "status": self.status.value,
            "text": self.text,
            "structured_tables": self.structured_tables,
            "pages": [
                {
                    "page_num": p.page_num,
                    "text": p.text[:500] + "..." if len(p.text) > 500 else p.text,  # 미리보기용
                    "method": p.method.value,
                    "confidence": p.confidence,
                }
                for p in self.pages
            ],
            "page_count": self.page_count,
            "quality_score": self.quality_score,
            "quality_details": {
                "korean_ratio": self.quality_details.korean_ratio,
                "broken_char_ratio": self.quality_details.broken_char_ratio,
                "sentence_structure": self.quality_details.sentence_structure,
                "repetition_anomaly": self.quality_details.repetition_anomaly,
                "overall_score": self.quality_details.overall_score,
            } if self.quality_details else None,
            "extraction_method": self.extraction_method.value,
            "char_count": self.char_count,
            "token_count": self.token_count,
            "processing_time_ms": self.processing_time_ms,
            "error_message": self.error_message,
            "corrections": self.corrections,
            "extracted_at": self.extracted_at,
        }


class BaseExtractor(ABC):
    """텍스트 추출 기본 클래스"""
    
    @abstractmethod
    def extract(self, file_path: str) -> ExtractionResult:
        """파일에서 텍스트 추출"""
        pass
    
    @abstractmethod
    def supports(self, file_format: str) -> bool:
        """지원하는 파일 형식인지 확인"""
        pass
