from context.env_context import EnvContext
from context.fiction_context import FictionContext
from context.user_context import UserContext


# Create a class to manage context data, including user context class, env context class, and fiction context class.
class ContextData:
    def __init__(self, pid=None, personal_interests=None,
                 location=None, audio=None, fpv=None,
                 main_plot=None, characters=None, setting=None, scenes=None, style=None,
                 plot_connection=None, plot=None, writing_preferences=None):
        """
        Create a class to manage context data, including user context class, env context class, and fiction context class.
        :param pid:
        :param writing_preferences:
        :param personal_interests:
        :param location:
        :param audio:
        :param fpv:
        :param main_plot:
        :param characters:
        :param setting:
        :param scenes:
        :param style:
        :param plot_connection:
        """
        self.user_context = UserContext(pid, personal_interests)
        self.env_context = EnvContext(location, audio, fpv)
        self.fiction_context = FictionContext(main_plot, characters, setting, scenes, style, plot_connection, plot, writing_preferences)

    def fiction_context_to_dict(self):
        return {
            "main_plot": self.fiction_context.main_plot,
            "characters": self.fiction_context.characters,
            "setting": self.fiction_context.setting,
            "scenes": self.fiction_context.scenes,
            "style": self.fiction_context.style,
            "plot_connection": self.fiction_context.plot_connection,
            "plot": self.fiction_context.plot,
            "writing_preferences": self.fiction_context.writing_preferences}
    
    
    
    def get_current_image_sequence(self):
        """Get current image sequence from env_context."""
        return self.env_context.get_current_image_sequence()
    
