# Homebrew formula for the Safe Context agent (issue #26). `installer/build.ts` fills in the
# version, file name and checksum and writes the result to installer/dist/safecontext.rb.
# Not published yet: it goes in a tap repo (SafeContext/homebrew-tap) when Joe decides.
class Safecontext < Formula
  desc "Checks Claude Code prompts and cleans tool output on this Mac"
  homepage "https://github.com/SafeContext/safecontext"
  url "https://github.com/SafeContext/safecontext/releases/download/v{{version}}/{{tarball}}"
  version "{{version}}"
  sha256 "{{sha256}}"
  license :cannot_represent

  depends_on arch: :arm64
  depends_on :macos

  def install
    # Node.js, the bundled agent, ONNX Runtime, the tier 1 model and sc-extract, as built.
    libexec.install Dir["*"]
    bin.install_symlink libexec/"bin/safecontext"
  end

  service do
    run [opt_bin/"safecontext", "run"]
    keep_alive true
    process_type :interactive
  end

  def caveats
    <<~EOS
      Start the agent now and at every login:
        brew services start safecontext

      Then turn on the Safe Context plugin in Claude Code, or ask IT for the managed settings.
      Check everything with:
        safecontext doctor

      Optional, for context checks on this Mac: install Ollama, then
        ollama pull gemma4:e4b-it-q4_K_M
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/safecontext version")
  end
end
