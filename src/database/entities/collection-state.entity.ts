import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 수집 파이프라인 진행 상태 (커서/타임스탬프 등) */
@Entity("collection_state")
export class CollectionState {
  @PrimaryColumn()
  key: string;

  @Column({ type: "jsonb", nullable: true })
  value: unknown;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt: Date;
}
