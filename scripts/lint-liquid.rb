require 'liquid'

# jekyll-seo-tag 是 Jekyll 插件，纯 Liquid 解析器不认识 {% seo %}。
# 这里注册一个空实现占位，只为让语法检查能继续解析模板其余部分。
class SeoStub < Liquid::Tag
  def initialize(tag_name, markup, tokens)
    super
  end

  def render(_context)
    ''
  end
end
Liquid::Template.register_tag('seo', SeoStub)

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
puts bad.zero? ? "checked #{files.size} templates, 0 broken" : "checked #{files.size} templates, #{bad} broken"
exit(bad.zero? ? 0 : 1)
