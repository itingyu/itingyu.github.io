require 'liquid'

ROOT = ARGV[0] || '.'
files = Dir.glob(File.join(ROOT, '_layouts', '*.html')) +
        Dir.glob(File.join(ROOT, '_includes', '*.html'))

bad = 0
files.each do |f|
  src = File.read(f, encoding: 'UTF-8')
  begin
    Liquid::Template.parse(src, error_mode: :strict)
  rescue Liquid::SyntaxError => e
    bad += 1
    puts "SYNTAX ERROR: #{f}"
    puts "   #{e.message.lines.first(6).join('   ')}"
  rescue => e
    puts "OTHER (#{f}): #{e.class}: #{e.message.lines.first(2).join}"
  end
end
puts files.size == bad ? "ALL BROKEN" : "checked #{files.size} templates, #{bad} broken"
