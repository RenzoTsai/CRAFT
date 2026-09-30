# create a fiction context, including main plot, characters, and setting, scene, and style

class FictionContext:
    def __init__(self, main_plot=None, characters=None, setting=None, scenes=None, style=None, plot_connection=None, plot=None, writing_preferences=None):
        """
        Create a class for fiction context, including main plot, characters, setting, scene, and style.
        :param main_plot:
        :param characters:
        :param setting:
        :param scenes:
        :param style:
        :param writing_preferences:
        """
        self.main_plot = main_plot
        self.characters = characters if characters is not None else []
        self.setting = setting
        self.scenes = scenes if scenes is not None else []
        self.style = style
        self.plot_connection = plot_connection
        self.plot = plot if plot is not None else []
        self.writing_preferences = writing_preferences







    def set_plot(self, plot):
        self.plot = plot
    

