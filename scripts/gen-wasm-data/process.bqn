#!/usr/bin/env bqn
DataIn ← "../data-in"⊸•file.At
⟨Export⟩ ← •Import DataIn "bqn-libs/json.bqn"

alnum ← '_' ∾ ∾"0aA"+⟜↕¨ 10‿26‿26
lf ← @+10

Split ← (¬-˜⊢×·+`»⊸>)∘≠⊔⊢
TrimWS ← {(∨`∧∨`⌾⌽)¬𝕩∊' '‿lf}⊸/

all ← @
licenseNote ← @
{
  text ← •FChars DataIn "wasm_simd128-1.h"
  licenseNote ↩ text↑˜ ⊑/lf‿lf ⍷ text
  all ↩ @⊸≢¨⊸/ {
    s ← 𝕩↓text
    s ↩ (1+⊑s⊐'{') ↑ s
    s ' '¨⌾((s=lf)⊸/)↩
    s/˜↩ ¬ ∧⟜» s=' '
    ¬∨´"__DEPRECATED_FN_ATTRS"⍷s?
    !' '=⊑17↓s
    s↓˜↩ 18
    p0‿p12 ← ⊑∘⊐⟜'('⊸(↑⋈↓)s # p0: "ret __ATTRS name"; p12: "(args) __REQUIRE_CONSTANT... {"
    head ← ' ' Split p0
    ! 2≤≠head
    ret ← ⊑head
    name ← ¯1⊑head
    attrs ← ¯1↓1↓head
    
    p12 "("⊸∾⁼↩
    p1‿p2 ← ⊑∘⊐⟜')'⊸(↑⋈↓)p12 # p1: "T0 a0, T1 a1, ..."; p2: ") __REQUIRE_CONSTANT... {"
    p2 ") "⊸∾⁼↩
    p2 ∾⟜"{"⁼↩
    p2 TrimWS↩
    constArgs ← {"__"⊸∾⁼ ∾⟜")"⁼ "__REQUIRE_CONSTANT("⊸∾⁼ 𝕩}¨ ' ' Split p2
    
    args ← {
      ty‿name ← (∧`⌾⌽ 𝕩∊alnum) (¬⊸/⋈/) 𝕩
      ⟨TrimWS ty, "__"⊸∾⁼name⟩
    }¨ ',' Split p1
    
    {𝕊:
      isConst ← (1⊑¨args) ∊ constArgs
      ! (+´isConst) = ≠constArgs
      args {𝕨𝕊0:𝕨; "const "⊸∾⌾⊑ 𝕨}¨↩ isConst
    }⍟(×≠constArgs) @
    
    ext ← ⊑⟜"simd128"‿"relaxed-simd"‿"fp16" ⋈⁼ "__DEFAULT_FN_ATTRS"‿"__RELAXED_FN_ATTRS"‿"__FP16_FN_ATTRS" ⊐ attrs
    [
      "ret"‿"ext"‿"name"‿"args"
      ret‿ext‿name‿args
    ]
    ;@
  }¨ /"static __inline__" ⍷ text
}

# intrinsics done via defines
all∾↩ {
  # FP16Type ← {"float"‿n: "float16_t"‿n; 𝕩}¨⌾(3⊑⊢) {"v128_t":𝕩; "float": "float16_t"}⌾⊑
  FP16Type ← ⊢
  [
    ⊏𝕩
    {"wasm_f16x8"∾"wasm_f32x4"∾⁼𝕩}⌾(2⊸⊑) "fp16"⌾(1⊸⊑) FP16Type 1⊏𝕩
  ]
}¨ ("wasm_f32x4_extract_lane"‿"wasm_f32x4_replace_lane" ⊐˜ 1‿2⊸⊑¨ all) ⊏ all
all∾↩ {
  ret ← "v128_t"
  ext ← "simd128"
  n ← 128÷𝕩
  name ← ∾⟨"wasm_i", •Repr 𝕩, "x", •Repr n, "_shuffle"⟩
  args ← ⟨"v128_t"‿"a", "v128_t"‿"b"⟩ ∾ {"const int" ⋈ "c"∾•Repr 𝕩}¨ ↕n
  [
    "ret"‿"ext"‿"name"‿"args"
    ret‿ext‿name‿args
  ]
}¨ 8‿16‿32‿64

"../../data/wasm-1.json" •FChars Export [
  "intrinsics"‿"licenseInfo"
  ⟨all, licenseNote∾(4⥊lf)∾•FChars DataIn "llvm-license-1.txt"⟩
]






# https://github.com/rust-lang/stdarch/blob/master/crates/core_arch/src/wasm32/simd128.rs
# insert docs from Rust intrinsics
# too rust-interface-centric :/
# {
#   text ← •FChars DataIn "simd128.rs"
#   is2 ← ∧∾{(≠𝕩)+/𝕩 ⍷ text}¨ "pub fn"‿"pub unsafe fn"
#   names ← {s←𝕩↓text ⋄ " "⊸∾⁼ s↑˜⌊´s⊐"(<"}¨ is2
#   lns ← /text=lf
#   l ← lns⍋is2
#   _decWhile ← {-⟜1•_while_𝔽}
#   descs ← {
#     e ← {⊑((1+𝕩⊑lns)⊑text)∊"#) "}_decWhile 𝕩
#     s ← {"///"≡3↑(1+𝕩⊑lns)↓text}_decWhile e
#     t ← {s‿e: s↓e↑text} ⟨s, e+1⟩⊏lns
#     ! ∨´ "///" ⍷ t
#     TrimWS {¬0∾(lf∾' ')⍷𝕩}⊸/ {¬ ∨⟜»⍟2 0∾0‿0∾˜(lf∾"///")⍷𝕩}⊸/ t
#   }¨ l-2
#   •Show ≠all
#   •Show 10↑5↓¨ 1‿2⊸⊑¨ all
#   didx ← names ⊐ {∨´"shuffle"⍷𝕩? @; 𝕩}¨ 5↓¨ 1‿2⊸⊑¨ all
#   all {𝕩≡≠names? 𝕨; 𝕨 ∾˘ ⟨"desc", 𝕩⊑descs⟩}¨↩ didx
# }
# if (desc) {
#   desc = desc.replace(/\n\n/g, '<br>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\n/g, ' ');
# }
