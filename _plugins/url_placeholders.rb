# _plugins/url_placeholders.rb
# 给 UrlDrop 注入自定义 placeholder,让 permalink /notes/:column/:series/:slug/ 能工作
require 'jekyll'
module Jekyll
  module Drops
    class UrlDrop
      data_delegators "column", "series"
    end
  end
end
