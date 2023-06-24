import java.io.*;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class App {
    private String srcDir;
    private String destBaseDir;
    private boolean copyOther;
    private SimpleDateFormat simpleDateFormat = new SimpleDateFormat("yyyy-MM-dd  HH:mm:ss sss");
    public App(String src, String dest,boolean copyOther) {
        this.srcDir=src;
        this.destBaseDir=dest;
        this.copyOther = copyOther;
    }

    public void copyOtherFiles(File src,File des){
        try(FileInputStream fis = new FileInputStream(src);FileOutputStream fos = new FileOutputStream(des)){
            byte[] buf = new byte[2048];
            int read;
            while ((read=fis.read(buf))!=-1){
                fos.write(buf,0,read);
            }
        } catch (FileNotFoundException e) {
            e.printStackTrace();
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
    public void addFrontMatter(File src,File des,String path) {
        String date = simpleDateFormat.format(new Date());
        String[] categories = path.split("/");
        StringBuilder frontMatter = new StringBuilder();
        frontMatter.append("---\n")
                .append("title: ").append(src.getName().replace(".md","")).append("\n")
                .append("date: ").append(date).append("\n");
        frontMatter.append("categories:\n");
        for (int i = 0; i < categories.length; i++) {
            if(categories[i].length()>0)
                frontMatter.append("  - ").append(categories[i]).append("\n");
        }
        frontMatter.append("tags:\n");
        for (int i = 0; i < categories.length; i++) {
            if(categories[i].length()>0)
                frontMatter.append("  - ").append(categories[i]).append("\n");
        }
        frontMatter.append("---\n\n");

        try {
            des.createNewFile();
        } catch (IOException e) {
            e.printStackTrace();
        }
        try (InputStreamReader reader = new InputStreamReader(new FileInputStream(src),"utf8");
             OutputStreamWriter writer = new OutputStreamWriter(new FileOutputStream(des),"utf8")){
            writer.write(frontMatter.toString());
            char[] buf=new char[1024];
            int read;
            while ((read=reader.read(buf))!=-1){
                writer.write(buf,0,read);
            }
        }catch (IOException e){
            e.printStackTrace();
        }
    }
    public void start(){
        File src = new File(srcDir);
        dst(src,"");
    }
    public void dst(File src,String path) {
        if(src.exists()){
            if(src.isDirectory()){
                File[] files = src.listFiles();
                path+='/'+src.getName();
                for (File file : files) {
                    dst(file,path);
                }
            }else {
                if(src.getName().endsWith(".md")||copyOther){
                    File dir = new File(destBaseDir,path);
                    if(!dir.exists()){
                        dir.mkdirs();
                    }
                    try {
                        File dest = new File(dir,src.getName());
                        dest.createNewFile();
                        System.out.println(dest.getAbsolutePath());
                       if(src.getName().endsWith(".md")){
                           addFrontMatter(src,dest,path);
                       }else {
                           copyOtherFiles(src,dest);
                       }
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }
        }
    }
    public static void main(String[] args) {

        System.out.println(args.length);
        String srcDir = args[0];
        String destDir = args[1];
        boolean copyOther=false;
        if (args.length>2){
             copyOther = Boolean.valueOf(args[2]);
        }

        App app = new App(srcDir, destDir,copyOther);
        app.start();
    }
}
