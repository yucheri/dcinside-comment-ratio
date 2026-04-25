# DCInside Comment Ratio

DCInside 게시물 목록, 게시글 본문 작성자, 댓글 작성자, 게시글 본문 하단 목록에서 작성자 닉네임의 글댓비를 색상으로 표현한다요.

## 티어 기준

`댓글 수 / 글 수`가 높을수록 색깔이 변한다요.

| 색깔 | 기준 |
| --- | --- |
| ![빨간색](https://img.shields.io/badge/%EB%B9%A8%EA%B0%84%EC%83%89-e33232?style=flat-square) | 글:댓글 비율 `1:2` 미만 |
| ![주황색](https://img.shields.io/badge/%EC%A3%BC%ED%99%A9%EC%83%89-e66a1f?style=flat-square) | 글:댓글 비율 `1:2` 이상 ~ `1:3` 미만 |
| ![노란색](https://img.shields.io/badge/%EB%85%B8%EB%9E%80%EC%83%89-d6a600?style=flat-square) | 글:댓글 비율 `1:3` 이상 ~ `1:4` 미만 |
| ![연두색](https://img.shields.io/badge/%EC%97%B0%EB%91%90%EC%83%89-62b51f?style=flat-square) | 글:댓글 비율 `1:4` 이상 ~ `1:5` 미만 |
| ![초록색](https://img.shields.io/badge/%EC%B4%88%EB%A1%9D%EC%83%89-0f9a3d?style=flat-square) | 글:댓글 비율 `1:5` 이상 |

유동닉/IP 작성자는 계정 uid가 없어서 색상을 변경하지 않는다요.

<p align="center">
  <img src="https://github.com/user-attachments/assets/ccd422af-02ef-4175-ba9e-a6d2ba3e90b5" alt="DCInside Comment Ratio 설치 학습만화" width="760">
</p>

## 설치

1. GitHub 저장소 오른쪽 위의 초록색 `Code` 버튼을 누른다요.
2. `Download ZIP`을 눌러 코드를 다운로드한다요.
3. 다운로드한 ZIP 파일을 압축 해제한다요.
4. Chrome 주소창에 `chrome://extensions`를 입력해서 확장 프로그램 페이지를 연다요.
5. 오른쪽 위의 `개발자 모드`를 켠다요.
6. `압축해제된 확장 프로그램을 로드합니다` 버튼을 누른다요.
7. 압축 해제한 폴더를 선택한다요.
8. DCInside 페이지를 새로고침하면 닉네임 색상이 적용된다요.

파일을 수정한 뒤에는 `chrome://extensions`에서 이 확장 프로그램의 새로고침 버튼을 누르고 DCInside 페이지도 다시 새로고침해야 한다요.
