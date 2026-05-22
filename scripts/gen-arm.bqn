#!/usr/bin/env bqn
DataIn ← "data-in"⊸•file.At
⟨Export⟩ ← •Import DataIn "bqn-libs/json.bqn"

·←{
  lns ← ∾ •FLines∘DataIn¨ "gcc-arm_neon-1.h"‿"gcc-arm_fp16-1.h"‿"gcc-arm_bf16-1.h"
  all ← ⟨⟩
  opts ← ⟨⟩
  (↕≠lns) {
    𝕨𝕊"#pragma GCC push_options": opts∾↩<⟨⟩;
    𝕨𝕊"#pragma GCC pop_options": opts↓˜↩¯1;
    "#pragma GCC target"≡18↑𝕩?
      v ← ∾⟜""")"⁼ " ("""⊸∾⁼ 18↓𝕩
      ! '+'≡⊑v
      opts ∾⟜v⌾(¯1⊸⊑)↩;
    𝕨𝕊"{":
      i ← -⟜1•_while_({"":1;∨´⟨@+9,' '⟩=⊑𝕩}⊑⟜lns) 𝕨-1
      # •Show i
      ! "__attribute" ≡ 11↑ ⊑⟜lns i-1
      ! "__extension__" ≡ 13↑ ' '⊸≠⊸/ ⊑⟜lns i-2
      j ← ⋈⁼/"("⍷ i⊑lns
      o2 ← (∧`⌾⌽ "nothing"⊸≢¨)⊸/ '+'((⊢-˜+`×¬)∘=⊔⊢) {"":""; "+"∾⁼𝕩} ∾opts
      name ← {((∨`∧∨`⌾⌽)𝕩≠' ')/𝕩} j↑i⊑lns
      i‿name ! ∧´name∊'_'∾∾"0a"+⟜↕¨10‿26
      all∾↩< name‿o2
      # •Show⍟(2≤≠opts) ⟨opts, o2, name⟩
      ;
    @
  }¨ lns
  "../data/arm-extensions-1.json" •FChars Export ∧all
}