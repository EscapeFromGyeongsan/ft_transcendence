// 좌표에 돌을 놓는 게임이 선택해서 사용하는 행동.
// row/col은 0부터 시작하며 정수·범위·합법 여부는 엔진에서 검증한다.
export type PlaceAction = {
  type: "place";
  row: number;
  col: number;
};
